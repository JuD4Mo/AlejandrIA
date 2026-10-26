"""Calibra V2 en validación usando universos completos, sin tocar test."""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import scipy.sparse as sp
import torch
from sklearn.preprocessing import normalize

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).parents[1]))

from ml.evaluate_hybrid import collaborative_scores, load_model
from ml.recommendation import minmax_values, weighted_hybrid_score


def rank_of_target(scores: np.ndarray, candidates: np.ndarray, target: int) -> int:
    """Obtiene rango estable sin ordenar todo el catálogo."""
    position = int(np.flatnonzero(candidates == target)[0])
    target_score = scores[position]
    return int(np.count_nonzero(scores > target_score) + np.count_nonzero((scores == target_score) & (candidates < target)) + 1)


def metric_row(model: str, ranks: list[int], k: int, universe: str, coverage: float, content_weight: float | None = None) -> dict[str, object]:
    values = np.asarray(ranks)
    hit = values <= k
    return {
        "model": model,
        "content_weight": content_weight,
        "precision_at_k": float(hit.mean() / k),
        "recall_at_k": float(hit.mean()),
        "ndcg_at_k": float(np.where(hit, 1 / np.log2(values + 1), 0.0).mean()),
        "users": len(values),
        "candidate_universe": universe,
        "catalog_coverage": coverage,
    }


def evaluate_validation_catalogs(
    train: pd.DataFrame,
    valid: pd.DataFrame,
    matrix: sp.csr_matrix,
    book_idx_to_content_row: np.ndarray,
    model: torch.nn.Module,
    device: torch.device,
    popularity: np.ndarray,
    *,
    seed: int,
    max_users: int,
    k: int,
    weights: list[float],
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Evalúa dos universos y selecciona la fusión solo en validación.

    El universo colaborativo es el único donde contenido y colaborativo pueden
    fusionarse. El universo completo de contenido reporta únicamente contenido,
    porque no se inventan scores colaborativos para sus 364k libros adicionales.
    """
    positives = valid[valid.rating >= 4].sort_values("user_idx").drop_duplicates("user_idx")
    rng = np.random.default_rng(seed)
    users = np.sort(rng.choice(positives.user_idx.to_numpy(), size=min(max_users, len(positives)), replace=False))
    targets = positives.set_index("user_idx").book_idx.to_dict()
    user_train = train[train.user_idx.isin(users)]
    known = user_train.groupby("user_idx").book_idx.agg(set).to_dict()
    profile_items = user_train[user_train.rating >= 4].groupby("user_idx").book_idx.agg(list).to_dict()
    collaborative_catalog = np.arange(len(popularity), dtype=np.int64)
    content_catalog = np.arange(matrix.shape[0], dtype=np.int64)
    eligible_matrix = matrix[book_idx_to_content_row].tocsr()
    collab_ranks: dict[str, list[int]] = {name: [] for name in ("popularity", "collaborative", "content")}
    hybrid_ranks: dict[float, list[int]] = {weight: [] for weight in weights}
    content_full_ranks: list[int] = []
    for position, user in enumerate(users, start=1):
        user = int(user)
        target = int(targets[user])
        known_books = np.fromiter(known.get(user, set()), dtype=np.int64)
        collab_candidates = np.setdiff1d(collaborative_catalog, known_books, assume_unique=False)
        collab = collaborative_scores(model, np.full(len(collab_candidates), user, dtype=np.int64), collab_candidates, device)
        profile_rows = book_idx_to_content_row[np.asarray(profile_items.get(user, []), dtype=np.int64)]
        if len(profile_rows):
            profile = normalize(sp.csr_matrix(matrix[profile_rows].mean(axis=0)))
            collab_content = (eligible_matrix @ profile.T).toarray().ravel().astype(np.float32)[collab_candidates]
            available_content = np.ones(matrix.shape[0], dtype=bool)
            available_content[book_idx_to_content_row[known_books]] = False
            content_candidates = content_catalog[available_content]
            content_full = (matrix @ profile.T).toarray().ravel().astype(np.float32)[content_candidates]
        else:
            collab_content = np.zeros(len(collab_candidates), dtype=np.float32)
            content_candidates = content_catalog
            content_full = np.zeros(len(content_candidates), dtype=np.float32)
        popularity_score = np.log1p(popularity[collab_candidates]).astype(np.float32)
        collab_ranks["popularity"].append(rank_of_target(popularity_score, collab_candidates, target))
        collab_ranks["collaborative"].append(rank_of_target(collab, collab_candidates, target))
        collab_ranks["content"].append(rank_of_target(collab_content, collab_candidates, target))
        for weight in weights:
            fused = weighted_hybrid_score(minmax_values(collab_content), minmax_values(collab), weight)
            hybrid_ranks[weight].append(rank_of_target(fused, collab_candidates, target))
        target_row = int(book_idx_to_content_row[target])
        content_full_ranks.append(rank_of_target(content_full, content_candidates, target_row))
        if position % 10 == 0:
            print(f"[validación] usuario {position}/{len(users)}", flush=True)
    coverage = len(collaborative_catalog) / matrix.shape[0]
    metrics = [
        metric_row(name, ranks, k, "full_collaborative_eligible_catalog", coverage)
        for name, ranks in collab_ranks.items()
    ]
    metrics.extend(
        metric_row("hybrid", ranks, k, "full_collaborative_eligible_catalog", coverage, weight)
        for weight, ranks in hybrid_ranks.items()
    )
    metrics.append(metric_row("content", content_full_ranks, k, "full_content_catalog", 1.0))
    calibration = pd.DataFrame(metrics)
    candidates = calibration[calibration.model.eq("hybrid")]
    selected = candidates.sort_values(["ndcg_at_k", "recall_at_k", "content_weight"], ascending=[False, False, True]).iloc[0]
    selected_weight = float(selected.content_weight)
    selected_metrics = calibration[(~calibration.model.eq("hybrid")) | calibration.content_weight.eq(selected_weight)].copy()
    return calibration, selected_metrics


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ml-dir", type=Path, default=Path("data/ml_v2"))
    parser.add_argument("--collab-dir", type=Path, default=Path("artifacts/v2/collaborative_mf"))
    parser.add_argument("--content-dir", type=Path, default=Path("artifacts/v2/content_tfidf"))
    parser.add_argument("--output-dir", type=Path, default=Path("artifacts/v2/hybrid"))
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--users", type=int, default=100)
    parser.add_argument("--k", type=int, default=10)
    return parser.parse_args()


def main(args: argparse.Namespace) -> None:
    started = time.perf_counter()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    train = pd.read_parquet(args.ml_dir / "train.parquet", columns=["user_idx", "book_idx", "rating"])
    valid = pd.read_parquet(args.ml_dir / "valid.parquet", columns=["user_idx", "book_idx", "rating"])
    mapping = pd.read_parquet(args.ml_dir / "book_mapping.parquet", columns=["book_id", "book_idx"])
    content_mapping = pd.read_parquet(args.content_dir / "content_book_mapping.parquet", columns=["book_id", "content_row"])
    joined = mapping.merge(content_mapping, on="book_id", how="left").sort_values("book_idx")
    if joined.content_row.isna().any():
        raise ValueError("El índice de contenido no cubre todo el catálogo colaborativo.")
    matrix = sp.load_npz(args.content_dir / "book_tfidf.npz").tocsr()
    model, _ = load_model(args.collab_dir, device)
    popularity = train.groupby("book_idx").size().reindex(range(len(mapping)), fill_value=0).to_numpy(dtype=np.int64)
    weights = [round(value, 2) for value in np.linspace(0.0, 1.0, 11)]
    calibration, selected_metrics = evaluate_validation_catalogs(
        train, valid, matrix, joined.content_row.to_numpy(dtype=np.int64), model, device, popularity,
        seed=args.seed, max_users=args.users, k=args.k, weights=weights,
    )
    selected_weight = float(calibration[calibration.model.eq("hybrid")].sort_values(["ndcg_at_k", "recall_at_k", "content_weight"], ascending=[False, False, True]).iloc[0].content_weight)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    calibration.to_csv(args.output_dir / "calibration_full_catalog_validation.csv", index=False)
    selected_metrics.to_csv(args.output_dir / "validation_catalog_universes.csv", index=False)
    config_path = args.output_dir / "config.json"
    config = json.loads(config_path.read_text(encoding="utf-8"))
    config.update({
        "content_weight": selected_weight,
        "selection_split": "valid_full_collaborative_catalog",
        "test_used_for_selection": False,
        "validation_full_catalog_users": args.users,
        "validation_content_universe_books": int(matrix.shape[0]),
        "validation_collaborative_universe_books": int(len(mapping)),
        "validation_completed_seconds": time.perf_counter() - started,
    })
    config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")
    print(json.dumps({"content_weight": selected_weight, "elapsed_seconds": config["validation_completed_seconds"]}, indent=2))


if __name__ == "__main__":
    main(parse_args())
