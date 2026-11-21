"""Evaluación piloto de adaptación: soporte de train, objetivos valid/test separados, ítems congelados."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
import scipy.sparse as sp
import torch
from sklearn.preprocessing import normalize

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).parents[1]))

from ml.evaluate_hybrid import load_model
from ml.fold_in import solve_user_vector
from ml.recommendation import minmax_values, weighted_hybrid_score


def rank(scores: np.ndarray, target: int, known: np.ndarray) -> int:
    eligible = np.ones(len(scores), dtype=bool)
    eligible[known] = False
    indices = np.arange(len(scores))
    return int(np.count_nonzero(eligible & ((scores > scores[target]) | ((scores == scores[target]) & (indices < target))))) + 1


def metrics(frame: pd.DataFrame, k: int) -> pd.DataFrame:
    rows = []
    for keys, group in frame.groupby(["split", "support_size", "model", "regularization", "content_weight"], dropna=False):
        ranks = group["rank"].to_numpy()
        hit = ranks <= k
        rows.append(dict(zip(["split", "support_size", "model", "regularization", "content_weight"], keys)) | {
            "users": len(group), "precision_at_k": float(hit.mean() / k), "recall_at_k": float(hit.mean()),
            "ndcg_at_k": float(np.where(hit, 1 / np.log2(ranks + 1), 0).mean()), "mrr": float((1 / ranks).mean()), "median_rank": float(np.median(ranks)),
        })
    return pd.DataFrame(rows)


def main(args: argparse.Namespace) -> None:
    started = time.perf_counter()
    torch.set_num_threads(1)
    root = args.root
    args.output_dir.mkdir(parents=True, exist_ok=True)
    db = duckdb.connect()
    db.execute("SET memory_limit='768MB'")
    ml = root / "data/ml_v2"
    collab = root / "artifacts/v2/collaborative_mf"
    content_dir = root / "artifacts/v2/content_tfidf"
    model, _ = load_model(collab, torch.device("cpu"))
    vectors = model.item_embedding.weight.detach().numpy()
    biases = model.item_bias.weight.detach().numpy().ravel()
    global_mean = float(model.global_mean)
    mapping = pd.read_parquet(collab / "book_mapping.parquet", columns=["book_id", "book_idx"])
    content_mapping = pd.read_parquet(content_dir / "content_book_mapping.parquet")
    joined = mapping.merge(content_mapping, on="book_id").sort_values("book_idx")
    if len(joined) != len(mapping) or joined.content_row.isna().any():
        raise ValueError("El catálogo de contenido no cubre los ítems congelados.")
    content_rows = joined.content_row.to_numpy(dtype=np.int64)
    matrix = sp.load_npz(content_dir / "book_tfidf.npz").tocsr()
    pop_frame = db.execute("SELECT book_idx,count(*) AS n FROM read_parquet(?) GROUP BY book_idx", [str(ml / "train.parquet")]).df()
    popularity = np.zeros(len(mapping), dtype=np.float32)
    popularity[pop_frame.book_idx.to_numpy()] = pop_frame.n.to_numpy()
    policy_path = root / "src/ml/fold_in_policy.json"
    regularizations = [0.01, 0.1, 1.0, 10.0, 100.0]
    weights = [0.0, 0.1, 0.3, 0.5, 0.7, 0.9, 1.0]
    records = []
    chosen = None
    for split in ["valid", "test"]:
        positives = pd.read_parquet(ml / f"{split}.parquet", columns=["user_idx", "book_idx", "rating"])
        positives = positives[positives.rating >= 4].sort_values("user_idx").drop_duplicates("user_idx")
        sample = positives.sample(n=min(args.users, len(positives)), random_state=args.seed + (split == "test"))
        db.register("selected_users", sample[["user_idx"]])
        histories = db.execute("SELECT t.user_idx,t.book_idx,t.rating,t.date_added_utc FROM read_parquet(?) t JOIN selected_users u USING(user_idx)", [str(ml / "train.parquet")]).df()
        grouped = {int(user): frame.sort_values(["date_added_utc", "book_idx"], kind="stable") for user, frame in histories.groupby("user_idx")}
        for number, target_row in enumerate(sample.itertuples(index=False), 1):
            history = grouped.get(int(target_row.user_idx))
            if history is None:
                continue
            for n in [5, 10, 20]:
                if len(history) < n:
                    continue
                support = history.tail(n)
                indices = support.book_idx.to_numpy(dtype=np.int64)
                if int(target_row.book_idx) in indices:
                    raise ValueError("Objetivo presente en soporte: posible fuga.")
                positive = indices[support.rating.to_numpy() >= 4]
                if not len(positive):
                    continue
                profile = normalize(sp.csr_matrix(matrix[content_rows[positive]].mean(axis=0)))
                content = (matrix @ profile.T).toarray().ravel().astype(np.float32)[content_rows]
                content_norm = minmax_values(content)
                def record(name: str, scores: np.ndarray, reg: float | None = None, weight: float | None = None):
                    records.append({"split": split, "support_size": n, "model": name, "regularization": reg, "content_weight": weight, "rank": rank(scores, int(target_row.book_idx), indices)})
                record("popularity", popularity)
                record("content_profile", content)
                regs = regularizations if split == "valid" else [chosen[0]]
                for reg in regs:
                    vector, bias = solve_user_vector(vectors[indices], biases[indices], support.rating.to_numpy(), global_mean, reg)
                    collaborative = vectors @ vector + biases + global_mean + bias
                    record("fold_in_collaborative", collaborative, reg)
                    collab_norm = minmax_values(collaborative)
                    for weight in (weights if split == "valid" else [chosen[1]]):
                        record("fold_in_hybrid", weighted_hybrid_score(content_norm, collab_norm, weight), reg, weight)
            if number % 20 == 0:
                print(f"[{split}] {number}/{len(sample)}", flush=True)
        summary = metrics(pd.DataFrame(records), args.k)
        if split == "valid":
            candidates = summary[(summary.split == "valid") & (summary.model == "fold_in_hybrid") & (summary.content_weight > 0) & (summary.content_weight < 1)]
            scores = candidates.groupby(["regularization", "content_weight"])[["ndcg_at_k", "recall_at_k", "mrr"]].mean().reset_index()
            best = scores.sort_values(["ndcg_at_k", "recall_at_k", "mrr", "regularization"], ascending=[False, False, False, False]).iloc[0]
            chosen = float(best.regularization), float(best.content_weight)
            print(f"Selección valid: regularization={chosen[0]} content_weight={chosen[1]}", flush=True)
            if args.update_policy:
                policy = json.loads(policy_path.read_text())
                policy.update(regularization=chosen[0], content_weight=chosen[1], policy_status="pilot_validation_selected", calibration_seed=args.seed, calibration_users=args.users)
                policy_path.write_text(json.dumps(policy, indent=2) + "\n")
        summary.to_csv(args.output_dir / "metrics.csv", index=False)
    report = {"protocol": "simulated_local_support_last_5_10_20_train_ratings", "candidate_universe": "full_collaborative_catalog_minus_support", "items_frozen": True,
              "selection_split": "valid", "test_used_for_selection": False, "users_requested_per_split": args.users, "seed": args.seed, "k": args.k,
              "regularization": chosen[0], "content_weight": chosen[1], "elapsed_seconds": time.perf_counter() - started,
              "limitations": ["Usuarios históricos contribuyeron al entrenamiento de ítems: no es evaluación estricta de usuarios completamente nuevos.", "Un objetivo positivo por usuario y soporte limitado; muestra piloto, no garantía de mejora local.", "date_added_utc conserva la semántica de fecha añadida, no fecha de lectura."]}
    report["policy_file_sha256_at_evaluation"] = hashlib.sha256(policy_path.read_bytes()).hexdigest()
    (args.output_dir / "evaluation.json").write_text(json.dumps(report, indent=2, ensure_ascii=False))
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("."))
    parser.add_argument("--output-dir", type=Path, default=Path("data/reports_fold_in"))
    parser.add_argument("--users", type=int, default=100)
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--k", type=int, default=10)
    parser.add_argument("--update-policy", action="store_true")
    main(parser.parse_args())
