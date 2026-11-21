"""Adaptación determinista de usuarios locales con ítems congelados y MSE regularizado."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np
import scipy.sparse as sp
from sklearn.preprocessing import normalize

from .recommendation import minmax_values, weighted_hybrid_score

if TYPE_CHECKING:
    from .inference import RecommendationEngine


def solve_user_vector(item_vectors: np.ndarray, item_bias: np.ndarray, ratings: np.ndarray, global_mean: float, regularization: float) -> tuple[np.ndarray, float]:
    """Minimiza sum((r-mu-bi-p·qi-bu)^2) + lambda*(||p||²+bu²), en float64."""
    vectors = np.asarray(item_vectors, dtype=np.float64)
    targets = np.asarray(ratings, dtype=np.float64)
    biases = np.asarray(item_bias, dtype=np.float64)
    if vectors.ndim != 2 or len(vectors) == 0 or targets.shape != (len(vectors),) or biases.shape != targets.shape:
        raise ValueError("Dimensiones de fold-in incompatibles.")
    if not all(np.isfinite(values).all() for values in (vectors, targets, biases)) or not np.isfinite(global_mean):
        raise ValueError("Fold-in requiere valores finitos.")
    if not np.isfinite(regularization) or regularization <= 0:
        raise ValueError("La regularización debe ser positiva.")
    design = np.column_stack((vectors, np.ones(len(vectors))))
    residual = targets - global_mean - biases
    coefficients = np.linalg.solve(design.T @ design + regularization * np.eye(design.shape[1]), design.T @ residual)
    if not np.isfinite(coefficients).all():
        raise ValueError("El perfil adaptado no es finito.")
    return coefficients[:-1].astype(np.float32), float(coefficients[-1])


def model_info(engine: RecommendationEngine) -> dict:
    policy_path = Path(__file__).with_name("fold_in_policy.json")
    policy = json.loads(policy_path.read_text(encoding="utf-8"))
    if not np.isfinite([policy["regularization"], policy["content_weight"]]).all() or policy["regularization"] <= 0 or not 0 < policy["content_weight"] < 1 or policy["minimum_ratings"] < 1:
        raise ValueError("Política fold-in inválida.")
    digest = hashlib.sha256()
    for path in [engine.collab_dir / "best_model.pt", engine.collab_dir / "book_mapping.parquet", engine.collab_dir / "config.json",
                 engine.content_dir / "content_book_mapping.parquet", engine.content_dir / "tfidf_vectorizer.joblib", engine.content_dir / "book_tfidf.npz", policy_path, Path(__file__)]:
        digest.update(path.name.encode())
        with path.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
    return {**policy, "model_signature": digest.hexdigest(), "model_version": engine.version, "factors": engine.model.item_embedding.embedding_dim}


def fit_profile(engine: RecommendationEngine, ratings: list[dict]) -> dict:
    info = engine.fold_in_info
    ordered = sorted(ratings, key=lambda row: row["book_id"])
    ids = [row["book_id"] for row in ordered]
    if len(ids) != len(set(ids)):
        raise ValueError("Las valoraciones deben ser únicas por libro.")
    values = np.asarray([row["rating"] for row in ordered], dtype=np.float64)
    if not np.isfinite(values).all() or ((values < 1) | (values > 5) | (values != np.floor(values))).any():
        raise ValueError("Ratings explícitos válidos: 1–5.")
    indices = engine.book_mapping.set_index("book_id").book_idx.reindex(ids)
    matched = indices.notna().to_numpy()
    matched_indices = indices[matched].to_numpy(dtype=np.int64)
    positive_ids = []
    for id, rating in zip(ids, values, strict=True):
        if rating >= 4 and id in engine.book_id_to_content_row:
            row = int(engine.book_id_to_content_row[id])
            if np.any(engine.matrix.data[engine.matrix.indptr[row]:engine.matrix.indptr[row + 1]]):
                positive_ids.append(id)
    result = {"status": "insufficient", "reason": "minimum_ratings", "input_count": len(ids), "matched_count": int(matched.sum()), "positive_count": len(positive_ids), "minimum_ratings": info["minimum_ratings"], "model_signature": info["model_signature"], "factors": info["factors"], "profile": None}
    if matched.sum() < info["minimum_ratings"]:
        return result
    if not positive_ids:
        return {**result, "reason": "positive_content_required"}
    vectors = engine.model.item_embedding.weight.detach().cpu().numpy()[matched_indices]
    biases = engine.model.item_bias.weight.detach().cpu().numpy().ravel()[matched_indices]
    vector, bias = solve_user_vector(vectors, biases, values[matched], float(engine.model.global_mean), info["regularization"])
    snapshot = hashlib.sha256()
    for id, value in zip(ids, values, strict=True):
        encoded = id.encode("utf-8")
        snapshot.update(str(len(encoded)).encode() + b":" + encoded + f":{int(value)}\n".encode())
    profile = {"model_signature": info["model_signature"], "input_hash": snapshot.hexdigest(), "vector": vector.tolist(), "bias": bias, "positive_book_ids": positive_ids}
    return {**result, "status": "ready", "reason": "", "profile": profile}


def profile_scores(engine: RecommendationEngine, profile: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Scores de todo el universo colaborativo; las exposiciones no alteran la normalización."""
    if profile["model_signature"] != engine.fold_in_info["model_signature"]:
        raise ValueError("fold_in_model_mismatch")
    vector = np.asarray(profile["vector"], dtype=np.float32)
    if vector.shape != (engine.fold_in_info["factors"],) or not np.isfinite(vector).all() or not np.isfinite(profile["bias"]):
        raise ValueError("Vector local inválido.")
    vectors = engine.model.item_embedding.weight.detach().cpu().numpy()
    biases = engine.model.item_bias.weight.detach().cpu().numpy().ravel()
    collaborative = vectors @ vector + biases + float(engine.model.global_mean) + profile["bias"]
    rows = engine.book_id_to_content_row.reindex(profile["positive_book_ids"]).dropna().to_numpy(dtype=np.int64)
    if len(rows) == 0:
        raise ValueError("El perfil no tiene contenido positivo disponible.")
    content_profile = normalize(sp.csr_matrix(engine.matrix[rows].mean(axis=0)))
    content = (engine.matrix @ content_profile.T).toarray().ravel().astype(np.float32)[engine.book_idx_to_content_row]
    hybrid = weighted_hybrid_score(minmax_values(content), minmax_values(collaborative), engine.fold_in_info["content_weight"])
    return hybrid, content, collaborative


def recommend_profile(engine: RecommendationEngine, profile: dict, k: int, exclude_book_ids: list[str]):
    engine._validate_k(k)
    hybrid, content, collaborative = profile_scores(engine, profile)
    eligible = np.isfinite(hybrid) & (hybrid > 0)
    excluded = engine.book_mapping.set_index("book_id").book_idx.reindex(exclude_book_ids).dropna().to_numpy(dtype=np.int64)
    eligible[excluded] = False
    candidates = np.flatnonzero(eligible)
    top = candidates[np.argsort(-hybrid[candidates], kind="stable")[:k]]
    return engine._enrich(top, hybrid[top], "hybrid", {"content_score": content[top], "collaborative_score": collaborative[top], "score_scope": np.full(len(top), "collaborative_catalog")})
