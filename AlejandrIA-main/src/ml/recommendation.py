"""Funciones compartidas para evaluación y recomendadores de libros."""

from __future__ import annotations

from collections.abc import Callable

import numpy as np
import pandas as pd


def book_ids_for_indices(book_mapping: pd.DataFrame, book_indices: np.ndarray) -> np.ndarray:
    """Resuelve índices por la columna ``book_idx``, nunca por el orden de filas."""
    mapping = book_mapping.set_index("book_idx")["book_id"]
    return mapping.reindex(book_indices).to_numpy()


def make_candidates(
    train: pd.DataFrame,
    heldout: pd.DataFrame,
    num_items: int,
    seed: int,
    max_users: int = 5000,
    negatives: int = 1000,
    relevance_rating: float = 4,
) -> pd.DataFrame:
    """Crea candidatos: un positivo retenido y negativos no vistos por usuario."""
    positives = heldout[heldout.rating >= relevance_rating].sort_values("user_idx").drop_duplicates("user_idx")
    rng = np.random.default_rng(seed)
    users = positives.user_idx.to_numpy()
    selected = rng.choice(users, size=min(max_users, len(users)), replace=False)
    targets = positives[positives.user_idx.isin(selected)].set_index("user_idx").book_idx.to_dict()
    seen = train[train.user_idx.isin(selected)].groupby("user_idx").book_idx.agg(set).to_dict()
    user_activity = train.groupby("user_idx").size().to_dict()
    item_popularity = train.groupby("book_idx").size().to_dict()
    catalog = np.arange(num_items, dtype=np.int64)
    rows: list[pd.DataFrame] = []
    for user in sorted(selected):
        target = int(targets[user])
        available = np.setdiff1d(catalog, np.fromiter(seen.get(user, set()), dtype=np.int64), assume_unique=False)
        pool = available[available != target]
        sampled = rng.choice(pool, size=min(negatives, len(pool)), replace=False)
        candidates = np.concatenate(([target], sampled))
        rows.append(
            pd.DataFrame(
                {
                    "user_idx": user,
                    "book_idx": candidates,
                    "relevant": candidates == target,
                    "user_train_interactions": user_activity[user],
                    "target_train_popularity": item_popularity.get(target, 0),
                }
            )
        )
    return pd.concat(rows, ignore_index=True)


def ranking_metrics(candidates: pd.DataFrame, score_column: str, k: int = 10) -> tuple[pd.DataFrame, dict[str, float]]:
    """Calcula métricas por usuario sobre un conjunto de candidatos compartido."""
    ordered = candidates.sort_values(["user_idx", score_column, "book_idx"], ascending=[True, False, True]).copy()
    ordered["rank"] = ordered.groupby("user_idx").cumcount() + 1
    positives = ordered[ordered.relevant].copy()
    positives["hit"] = positives["rank"] <= k
    positives["precision_at_k"] = positives["hit"] / k
    positives["recall_at_k"] = positives["hit"].astype(float)
    positives["ndcg_at_k"] = np.where(positives["hit"], 1 / np.log2(positives["rank"] + 1), 0.0)
    metrics = {key: float(positives[key].mean()) for key in ("precision_at_k", "recall_at_k", "ndcg_at_k")}
    return positives, metrics


def minmax_by_user(candidates: pd.DataFrame, score_column: str, output_column: str) -> pd.DataFrame:
    """Normaliza por usuario solo con puntuaciones disponibles en sus candidatos."""
    result = candidates.copy()
    minimum = result.groupby("user_idx")[score_column].transform("min")
    maximum = result.groupby("user_idx")[score_column].transform("max")
    denominator = maximum - minimum
    result[output_column] = np.where(denominator > 0, (result[score_column] - minimum) / denominator, 0.0)
    return result


def minmax_values(values: np.ndarray) -> np.ndarray:
    """Normaliza un único vector de candidatos sin cambiar su universo."""
    values = np.asarray(values, dtype=np.float32)
    if len(values) == 0:
        return values
    spread = values.max() - values.min()
    return (values - values.min()) / spread if spread > 0 else np.zeros_like(values)


def weighted_hybrid_score(content_scores: np.ndarray, collaborative_scores: np.ndarray, content_weight: float) -> np.ndarray:
    """Combina puntuaciones previamente normalizadas con un peso validado."""
    if not 0 <= content_weight <= 1:
        raise ValueError("content_weight debe estar entre 0 y 1.")
    return content_weight * content_scores + (1 - content_weight) * collaborative_scores


def score_candidates(candidates: pd.DataFrame, scorer: Callable[[np.ndarray, np.ndarray], np.ndarray], output_column: str) -> pd.DataFrame:
    """Añade puntuaciones por lotes sin imponer un modelo concreto."""
    result = candidates.copy()
    result[output_column] = scorer(result.user_idx.to_numpy(dtype=np.int64), result.book_idx.to_numpy(dtype=np.int64))
    return result
