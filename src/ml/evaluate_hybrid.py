"""Calibra y evalúa contenido, colaborativo e híbrido V2 sin fuga temporal."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import scipy.sparse as sp
import torch
from sklearn.preprocessing import normalize

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).parents[1]))

from ml.collaborative import MatrixFactorization
from ml.content import content_candidate_scores
from ml.recommendation import make_candidates, minmax_by_user, ranking_metrics, weighted_hybrid_score


def load_model(collab_dir: Path, device: torch.device) -> tuple[MatrixFactorization, dict[str, object]]:
    """Restaura el modelo final seleccionado en validación de ratings."""
    config = json.loads((collab_dir / "config.json").read_text(encoding="utf-8"))
    checkpoint = torch.load(collab_dir / "best_model.pt", map_location=device, weights_only=True)
    model = MatrixFactorization(
        int(config["num_users"]), int(config["num_items"]), int(config["factors"]), float(config["global_mean"])
    ).to(device)
    model.load_state_dict(checkpoint["state_dict"])
    model.eval()
    return model, config


def collaborative_scores(model: MatrixFactorization, users: np.ndarray, books: np.ndarray, device: torch.device) -> np.ndarray:
    """Puntúa pares usuario-libro en lotes para no agotar VRAM."""
    scores = np.empty(len(users), dtype=np.float32)
    with torch.inference_mode():
        for start in range(0, len(users), 262_144):
            stop = min(start + 262_144, len(users))
            scores[start:stop] = model(
                torch.as_tensor(users[start:stop].copy(), device=device), torch.as_tensor(books[start:stop].copy(), device=device)
            ).cpu().numpy()
    return scores


def selected_train(train: pd.DataFrame, candidates: pd.DataFrame) -> pd.DataFrame:
    """Reduce train a usuarios evaluados antes de agrupar historiales."""
    users = candidates.user_idx.unique()
    return train[train.user_idx.isin(users)]


def score_candidate_set(
    candidates: pd.DataFrame,
    train_for_users: pd.DataFrame,
    matrix: sp.csr_matrix,
    book_idx_to_content_row: np.ndarray,
    model: MatrixFactorization,
    device: torch.device,
    popularity: np.ndarray,
    content_workers: int,
) -> pd.DataFrame:
    """Añade los tres componentes sobre exactamente los mismos candidatos."""
    result = candidates.reset_index(drop=True).copy()
    users = result.user_idx.to_numpy(dtype=np.int64)
    books = result.book_idx.to_numpy(dtype=np.int64)
    result["collaborative_score"] = collaborative_scores(model, users, books, device)
    result["content_score"] = content_candidate_scores(
        result, train_for_users, book_idx_to_content_row, matrix, workers=content_workers
    )
    result["popularity_score"] = np.log1p(popularity[books]).astype(np.float32)
    result = minmax_by_user(result, "collaborative_score", "collaborative_normalized")
    result = minmax_by_user(result, "content_score", "content_normalized")
    return result


def evaluate_scores(candidates: pd.DataFrame, content_weight: float, k: int) -> pd.DataFrame:
    """Resume las métricas de modelos simples e híbrido a un mismo K."""
    scored = candidates.copy()
    scored["hybrid_score"] = weighted_hybrid_score(
        scored.content_normalized.to_numpy(), scored.collaborative_normalized.to_numpy(), content_weight
    )
    rows = []
    for model, column in (
        ("popularity", "popularity_score"),
        ("collaborative", "collaborative_score"),
        ("content", "content_score"),
        ("hybrid", "hybrid_score"),
    ):
        _, metrics = ranking_metrics(scored, column, k=k)
        rows.append({"model": model, "content_weight": content_weight if model == "hybrid" else np.nan, **metrics})
    return pd.DataFrame(rows)


def calibrate(candidates: pd.DataFrame, weights: list[float], k: int) -> tuple[float, pd.DataFrame]:
    """Selecciona el peso por NDCG@K exclusivamente en validación."""
    evaluations = []
    for weight in weights:
        metrics = evaluate_scores(candidates, weight, k)
        hybrid = metrics.loc[metrics.model.eq("hybrid")].iloc[0].to_dict()
        evaluations.append(hybrid)
    table = pd.DataFrame(evaluations).sort_values("content_weight").reset_index(drop=True)
    best = table.sort_values(["ndcg_at_k", "recall_at_k", "content_weight"], ascending=[False, False, True]).iloc[0]
    return float(best.content_weight), table


def full_catalog_metrics(
    heldout: pd.DataFrame,
    train: pd.DataFrame,
    matrix: sp.csr_matrix,
    book_idx_to_content_row: np.ndarray,
    model: MatrixFactorization,
    device: torch.device,
    popularity: np.ndarray,
    content_weight: float,
    *,
    seed: int,
    max_users: int,
    k: int,
) -> pd.DataFrame:
    """Evalúa una muestra de usuarios contra todo el catálogo entrenable elegible.

    No incorpora libros sin embedding colaborativo: así los cuatro métodos tienen el
    mismo universo de candidatos. Esa cobertura se registra en el resumen final.
    """
    positives = heldout[heldout.rating >= 4].sort_values("user_idx").drop_duplicates("user_idx")
    rng = np.random.default_rng(seed)
    users = rng.choice(positives.user_idx.to_numpy(), size=min(max_users, len(positives)), replace=False)
    targets = positives.set_index("user_idx").book_idx.to_dict()
    user_train = train[train.user_idx.isin(users)]
    known = user_train.groupby("user_idx").book_idx.agg(set).to_dict()
    profile_items = user_train[user_train.rating >= 4].groupby("user_idx").book_idx.agg(list).to_dict()
    catalog = np.arange(len(popularity), dtype=np.int64)
    # Reordenar una única vez evita copiar 566k filas de TF-IDF por usuario.
    eligible_matrix = matrix[book_idx_to_content_row].tocsr()
    ranks: dict[str, list[int]] = {name: [] for name in ("popularity", "collaborative", "content", "hybrid")}
    for user in np.sort(users):
        target = int(targets[int(user)])
        candidates = np.setdiff1d(catalog, np.fromiter(known.get(int(user), set()), dtype=np.int64), assume_unique=False)
        collab = collaborative_scores(model, np.full(len(candidates), user, dtype=np.int64), candidates, device)
        positive_rows = book_idx_to_content_row[np.asarray(profile_items.get(int(user), []), dtype=np.int64)]
        positive_rows = positive_rows[positive_rows >= 0]
        if len(positive_rows):
            profile = normalize(sp.csr_matrix(matrix[positive_rows].mean(axis=0)))
            content = (eligible_matrix @ profile.T).toarray().ravel().astype(np.float32)[candidates]
        else:
            content = np.zeros(len(candidates), dtype=np.float32)
        popularity_score = np.log1p(popularity[candidates]).astype(np.float32)
        collab_norm = (collab - collab.min()) / (collab.max() - collab.min()) if collab.max() > collab.min() else np.zeros_like(collab)
        content_norm = (content - content.min()) / (content.max() - content.min()) if content.max() > content.min() else np.zeros_like(content)
        scores = {
            "popularity": popularity_score,
            "collaborative": collab,
            "content": content,
            "hybrid": weighted_hybrid_score(content_norm, collab_norm, content_weight),
        }
        target_position = int(np.flatnonzero(candidates == target)[0])
        for name, values in scores.items():
            target_score = values[target_position]
            rank = int(np.count_nonzero(values > target_score) + np.count_nonzero((values == target_score) & (candidates < target)) + 1)
            ranks[name].append(rank)
    rows = []
    for name, values in ranks.items():
        values_array = np.asarray(values)
        hit = values_array <= k
        rows.append({
            "model": name,
            "content_weight": content_weight if name == "hybrid" else np.nan,
            "precision_at_k": float(hit.mean() / k),
            "recall_at_k": float(hit.mean()),
            "ndcg_at_k": float(np.where(hit, 1 / np.log2(values_array + 1), 0.0).mean()),
            "users": len(values_array),
            "candidate_universe": "full_collaborative_eligible_catalog",
        })
    return pd.DataFrame(rows)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ml-dir", type=Path, default=Path("data/ml_v2"))
    parser.add_argument("--collab-dir", type=Path, default=Path("artifacts/v2/collaborative_mf"))
    parser.add_argument("--content-dir", type=Path, default=Path("artifacts/v2/content_tfidf"))
    parser.add_argument("--output-dir", type=Path, default=Path("artifacts/v2/hybrid"))
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--max-users", type=int, default=5000)
    parser.add_argument("--negatives", type=int, default=1000)
    parser.add_argument("--full-catalog-users", type=int, default=100)
    parser.add_argument("--content-workers", type=int, default=min(8, os.cpu_count() or 1))
    parser.add_argument("--k", type=int, default=10)
    return parser.parse_args()


def main(args: argparse.Namespace) -> None:
    started = time.perf_counter()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    train = pd.read_parquet(args.ml_dir / "train.parquet", columns=["user_idx", "book_idx", "rating"])
    valid = pd.read_parquet(args.ml_dir / "valid.parquet", columns=["user_idx", "book_idx", "rating"])
    test = pd.read_parquet(args.ml_dir / "test.parquet", columns=["user_idx", "book_idx", "rating"])
    print(f"[hybrid] cargados splits en {time.perf_counter() - started:.1f}s", flush=True)
    book_mapping = pd.read_parquet(args.ml_dir / "book_mapping.parquet", columns=["book_id", "book_idx"])
    content_mapping = pd.read_parquet(args.content_dir / "content_book_mapping.parquet", columns=["book_id", "content_row"])
    joined = book_mapping.merge(content_mapping, on="book_id", how="left").sort_values("book_idx")
    if joined.content_row.isna().any():
        raise ValueError("El índice de contenido no cubre todo el catálogo colaborativo.")
    book_idx_to_content_row = joined.content_row.to_numpy(dtype=np.int64)
    matrix = sp.load_npz(args.content_dir / "book_tfidf.npz").tocsr()
    model, collab_config = load_model(args.collab_dir, device)
    popularity = train.groupby("book_idx").size().reindex(range(len(book_mapping)), fill_value=0).to_numpy(dtype=np.int64)
    valid_candidates = make_candidates(train, valid, len(book_mapping), args.seed, args.max_users, args.negatives)
    print(f"[hybrid] candidatos validación: {len(valid_candidates):,}", flush=True)
    valid_scored = score_candidate_set(valid_candidates, selected_train(train, valid_candidates), matrix, book_idx_to_content_row, model, device, popularity, args.content_workers)
    print(f"[hybrid] puntuación validación en {time.perf_counter() - started:.1f}s", flush=True)
    weights = [round(value, 2) for value in np.linspace(0.0, 1.0, 11)]
    selected_weight, calibration = calibrate(valid_scored, weights, args.k)
    valid_metrics = evaluate_scores(valid_scored, selected_weight, args.k)
    test_candidates = make_candidates(train, test, len(book_mapping), args.seed + 1, args.max_users, args.negatives)
    print(f"[hybrid] candidatos test: {len(test_candidates):,}; peso contenido={selected_weight:.2f}", flush=True)
    test_scored = score_candidate_set(test_candidates, selected_train(train, test_candidates), matrix, book_idx_to_content_row, model, device, popularity, args.content_workers)
    print(f"[hybrid] puntuación test en {time.perf_counter() - started:.1f}s", flush=True)
    test_metrics = evaluate_scores(test_scored, selected_weight, args.k)
    valid_full = full_catalog_metrics(valid, train, matrix, book_idx_to_content_row, model, device, popularity, selected_weight, seed=args.seed, max_users=args.full_catalog_users, k=args.k)
    test_full = full_catalog_metrics(test, train, matrix, book_idx_to_content_row, model, device, popularity, selected_weight, seed=args.seed + 1, max_users=args.full_catalog_users, k=args.k)
    print(f"[hybrid] evaluación catálogo completo en {time.perf_counter() - started:.1f}s", flush=True)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    calibration.to_csv(args.output_dir / "calibration_validation.csv", index=False)
    pd.concat([valid_metrics.assign(split="valid", protocol="sampled"), test_metrics.assign(split="test", protocol="sampled"), valid_full.assign(split="valid", protocol="full_catalog"), test_full.assign(split="test", protocol="full_catalog")]).to_csv(args.output_dir / "metrics.csv", index=False)
    diagnostic = {
        "sampled_content_weight": selected_weight,
        "selection_split": "valid_sampled_candidates",
        "test_used_for_diagnostic": True,
        "seed": args.seed,
        "k": args.k,
        "sampled_users": args.max_users,
        "sampled_negatives": args.negatives,
        "full_catalog_users": args.full_catalog_users,
        "content_books": int(matrix.shape[0]),
        "collaborative_books": int(len(book_mapping)),
        "content_only_books": int(matrix.shape[0] - len(book_mapping)),
        "collaborative_config": {key: collab_config[key] for key in ("factors", "best_epoch", "global_mean")},
    }
    # La configuración activa la escribe validate_full_catalog.py con validación completa.
    (args.output_dir / "sampled_candidate_diagnostic.json").write_text(json.dumps(diagnostic, indent=2), encoding="utf-8")
    print(json.dumps(diagnostic, indent=2))


if __name__ == "__main__":
    main(parse_args())
