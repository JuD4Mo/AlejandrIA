"""Inferencia reproducible para modelos colaborativo, de contenido e híbrido."""

from __future__ import annotations

import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import scipy.sparse as sp
import torch
from sklearn.preprocessing import normalize

from .collaborative import MatrixFactorization
from .recommendation import book_ids_for_indices, minmax_values, weighted_hybrid_score


class RecommendationEngine:
    """Carga artefactos existentes y recomienda sin reentrenar."""

    def __init__(self, root: Path, device: str | None = None, version: str = "v1") -> None:
        self.root = root
        if version not in {"v1", "v2"}:
            raise ValueError("version debe ser 'v1' o 'v2'.")
        suffix = "_v2" if version == "v2" else ""
        artifacts_dir = root / "artifacts" / "v2" if version == "v2" else root / "artifacts"
        self.version = version
        self.ml_dir = root / "data" / f"ml{suffix}"
        self.processed_dir = root / "data" / f"processed{suffix}"
        self.collab_dir = artifacts_dir / "collaborative_mf"
        self.content_dir = artifacts_dir / "content_tfidf"
        self.hybrid_dir = artifacts_dir / "hybrid"
        self.device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
        self.user_mapping = pd.read_parquet(self.collab_dir / "user_mapping.parquet")
        self.book_mapping = pd.read_parquet(self.collab_dir / "book_mapping.parquet")
        self.train_path = self.ml_dir / "train.parquet"
        self._history_cache: dict[int, tuple[np.ndarray, np.ndarray]] = {}
        self._profile_cache: dict[int, sp.csr_matrix | None] = {}
        config = json.loads((self.collab_dir / "config.json").read_text(encoding="utf-8"))
        checkpoint = torch.load(self.collab_dir / "best_model.pt", map_location=self.device, weights_only=True)
        self.model = MatrixFactorization(config["num_users"], config["num_items"], config["factors"], config["global_mean"]).to(self.device)
        self.model.load_state_dict(checkpoint["state_dict"])
        self.model.eval()
        self.vectorizer = joblib.load(self.content_dir / "tfidf_vectorizer.joblib")
        self.matrix = sp.load_npz(self.content_dir / "book_tfidf.npz").tocsr()
        content_mapping = pd.read_parquet(self.content_dir / "content_book_mapping.parquet")
        joined_mapping = self.book_mapping.merge(content_mapping, on="book_id", how="left").sort_values("book_idx")
        if len(joined_mapping) != len(self.book_mapping) or joined_mapping.content_row.isna().any():
            raise ValueError("El mapping de contenido no cubre todos los libros entrenables.")
        self.book_idx_to_content_row = joined_mapping.content_row.to_numpy(dtype=np.int64)
        ordered_content = content_mapping.sort_values("content_row")
        if not np.array_equal(ordered_content.content_row.to_numpy(), np.arange(len(ordered_content))):
            raise ValueError("content_row debe ser consecutivo y empezar en cero.")
        self.content_book_ids = ordered_content.book_id.to_numpy()
        self.book_id_to_content_row = ordered_content.set_index("book_id").content_row
        self.collaborative_content_mask = np.zeros(self.matrix.shape[0], dtype=bool)
        self.collaborative_content_mask[self.book_idx_to_content_row] = True
        self.hybrid_config = json.loads((self.hybrid_dir / "config.json").read_text(encoding="utf-8"))
        self.user_to_idx = self.user_mapping.set_index("user_id").user_idx.to_dict()
        self.metadata = self._metadata()
        self.metadata_by_book_id = self.metadata.set_index("book_id")

    def _metadata(self) -> pd.DataFrame:
        books = pd.read_parquet(self.processed_dir / "books.parquet")[["book_id", "title"]]
        authors = pd.read_parquet(self.processed_dir / "authors.parquet")[["author_id", "name"]]
        relations = pd.read_parquet(self.processed_dir / "book_authors.parquet")[["book_id", "author_id"]]
        genres = pd.read_parquet(self.processed_dir / "book_genres.parquet")[["book_id", "genre"]]
        author_text = relations.merge(authors, on="author_id", how="left").groupby("book_id").name.agg(lambda x: " | ".join(sorted(set(x.dropna()))))
        genre_text = genres.groupby("book_id").genre.agg(lambda x: " | ".join(sorted(set(x.dropna()))))
        result = books.copy()
        result["authors"] = result.book_id.map(author_text).fillna("")
        result["genres"] = result.book_id.map(genre_text).fillna("")
        return result

    @staticmethod
    def _validate_k(k: int) -> None:
        if k < 1:
            raise ValueError("k debe ser mayor que cero.")

    def _user_idx(self, user_id: str) -> int:
        if user_id not in self.user_to_idx:
            raise KeyError(f"Usuario desconocido: {user_id}")
        return int(self.user_to_idx[user_id])

    def _enrich(self, book_indices: np.ndarray, scores: np.ndarray, model: str, extra: dict[str, np.ndarray] | None = None) -> pd.DataFrame:
        book_ids = book_ids_for_indices(self.book_mapping, book_indices)
        return self._enrich_book_ids(book_ids, scores, model, extra)

    def _enrich_book_ids(self, book_ids: np.ndarray, scores: np.ndarray, model: str, extra: dict[str, np.ndarray] | None = None) -> pd.DataFrame:
        result = pd.DataFrame({"book_id": book_ids, "score": scores, "model": model})
        if extra:
            for key, values in extra.items():
                result[key] = values
        metadata = self.metadata_by_book_id.reindex(book_ids).reset_index()
        return pd.concat([result.reset_index(drop=True), metadata[["title", "authors", "genres"]].reset_index(drop=True)], axis=1)[
            ["book_id", "title", "authors", "genres", "score", "model", *(extra or {}).keys()]
        ]

    def _collaborative_scores(self, user_idx: int, candidates: np.ndarray) -> np.ndarray:
        values = np.empty(len(candidates), dtype=np.float32)
        with torch.inference_mode():
            for start in range(0, len(candidates), 262_144):
                stop = min(start + 262_144, len(candidates))
                values[start:stop] = self.model(
                    torch.full((stop - start,), user_idx, device=self.device), torch.tensor(candidates[start:stop], device=self.device)
                ).cpu().numpy()
        return values

    def _content_scores_for_user(self, user_idx: int, candidates: np.ndarray) -> np.ndarray:
        profile = self._profile_for_user(user_idx)
        if profile is None:
            return np.zeros(len(candidates), dtype=np.float32)
        return (profile @ self.matrix[self.book_idx_to_content_row[candidates]].T).toarray().ravel().astype(np.float32)

    def _profile_for_user(self, user_idx: int) -> sp.csr_matrix | None:
        """Construye y memoriza un perfil exclusivamente desde ratings positivos de train."""
        if user_idx in self._profile_cache:
            return self._profile_cache[user_idx]
        _, positives = self._user_history(user_idx)
        if len(positives) == 0:
            self._profile_cache[user_idx] = None
            return None
        rows = self.book_idx_to_content_row[positives]
        profile = normalize(sp.csr_matrix(self.matrix[rows].mean(axis=0)))
        self._profile_cache[user_idx] = profile
        return profile

    def _user_history(self, user_idx: int) -> tuple[np.ndarray, np.ndarray]:
        """Lee solo el historial del usuario para que V2 no retenga 60M filas en RAM."""
        cached = self._history_cache.get(user_idx)
        if cached is not None:
            return cached
        history = pd.read_parquet(self.train_path, filters=[("user_idx", "==", user_idx)], columns=["book_idx", "rating"])
        known = history.book_idx.to_numpy(dtype=np.int64)
        positives = history.loc[history.rating >= 4, "book_idx"].to_numpy(dtype=np.int64)
        self._history_cache[user_idx] = (known, positives)
        return known, positives

    def _unknown_candidates(self, user_idx: int) -> np.ndarray:
        known, _ = self._user_history(user_idx)
        return np.setdiff1d(np.arange(len(self.book_mapping), dtype=np.int64), known, assume_unique=False)

    def _available_content_rows(self, user_idx: int) -> np.ndarray:
        """Devuelve filas de contenido no vistas, sin reconstruir mapeos desde disco."""
        known, _ = self._user_history(user_idx)
        seen_rows = self.book_idx_to_content_row[known]
        available = np.ones(self.matrix.shape[0], dtype=bool)
        available[seen_rows] = False
        return np.flatnonzero(available)

    def recommend_collaborative(self, user_id: str, k: int = 10) -> pd.DataFrame:
        self._validate_k(k)
        user_idx = self._user_idx(user_id)
        candidates = self._unknown_candidates(user_idx)
        scores = self._collaborative_scores(user_idx, candidates)
        top = np.argsort(-scores)[:k]
        return self._enrich(candidates[top], scores[top], "collaborative")

    def recommend_similar(self, book_id: str, k: int = 10) -> pd.DataFrame:
        self._validate_k(k)
        if book_id not in self.book_id_to_content_row:
            raise KeyError(f"Libro desconocido: {book_id}")
        row = int(self.book_id_to_content_row[book_id])
        scores = (self.matrix[row] @ self.matrix.T).toarray().ravel()
        scores[row] = -np.inf
        top_rows = np.argsort(-scores)[:k]
        return self._enrich_book_ids(self.content_book_ids[top_rows], scores[top_rows], "content_similar")

    def recommend_hybrid(self, user_id: str, k: int = 10) -> pd.DataFrame:
        """Recomienda solo en el universo colaborativo con la escala calibrada en validación.

        Los libros sin embedding no se mezclan aquí: sus scores de contenido no son
        comparables con la fusión híbrida. Use ``recommend_content_only`` por separado.
        """
        self._validate_k(k)
        user_idx = self._user_idx(user_id)
        candidates = self._unknown_candidates(user_idx)
        collaborative = self._collaborative_scores(user_idx, candidates)
        profile = self._profile_for_user(user_idx)
        if profile is None:
            content = np.zeros(len(candidates), dtype=np.float32)
        else:
            content = (profile @ self.matrix[self.book_idx_to_content_row[candidates]].T).toarray().ravel().astype(np.float32)
        hybrid = weighted_hybrid_score(minmax_values(content), minmax_values(collaborative), float(self.hybrid_config["content_weight"]))
        result = self._enrich(candidates, hybrid, "hybrid", {
            "content_score": content,
            "collaborative_score": collaborative,
            "availability": np.full(len(candidates), "collaborative_catalog"),
            "score_scope": np.full(len(candidates), "collaborative_catalog"),
        })
        return result.nlargest(k, "score", keep="all").head(k).reset_index(drop=True)

    def recommend_content_only(self, user_id: str, k: int = 10) -> pd.DataFrame:
        """Recomienda los libros sin embedding según contenido, en un ranking separado."""
        self._validate_k(k)
        user_idx = self._user_idx(user_id)
        profile = self._profile_for_user(user_idx)
        if profile is None:
            raise ValueError("El usuario no tiene ratings positivos de entrenamiento para contenido.")
        rows = self._available_content_rows(user_idx)
        rows = rows[~self.collaborative_content_mask[rows]]
        scores = (profile @ self.matrix[rows].T).toarray().ravel().astype(np.float32)
        top = np.argsort(-scores)[:k]
        top_rows = rows[top]
        return self._enrich_book_ids(self.content_book_ids[top_rows], minmax_values(scores)[top], "content_only", {
            "content_score": scores[top],
            "collaborative_score": np.full(len(top), np.nan),
            "availability": np.full(len(top), "content_only"),
            "score_scope": np.full(len(top), "content_only_catalog"),
        })

    def recommend_new_user(self, preferences: str | dict[str, list[str]], k: int = 10) -> pd.DataFrame:
        self._validate_k(k)
        if isinstance(preferences, dict):
            text = " ".join(value for values in preferences.values() for value in values)
        else:
            text = preferences
        if not text.strip():
            raise ValueError("Las preferencias del usuario nuevo no pueden estar vacías.")
        scores = (self.vectorizer.transform([text]) @ self.matrix.T).toarray().ravel()
        top_rows = np.argsort(-scores)[:k]
        return self._enrich_book_ids(self.content_book_ids[top_rows], scores[top_rows], "content_cold_start")
