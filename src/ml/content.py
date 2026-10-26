"""Construcción y puntuación dispersa del recomendador TF-IDF de contenido."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pandas as pd
from scipy import sparse
from sklearn.preprocessing import normalize


SOCIAL_SHELF_LABELS = {
    "to-read", "currently-reading", "read", "owned", "favorites", "favourites",
    "default", "books-i-own", "my-library", "all", "want-to-read", "did-not-finish",
    "dnf", "audiobook", "kindle", "ebook", "physical-tbr",
}


def build_content_frame(
    books: pd.DataFrame,
    book_authors: pd.DataFrame,
    authors: pd.DataFrame,
    book_genres: pd.DataFrame,
    source_genres: pd.DataFrame,
) -> pd.DataFrame:
    """Combina campos bibliográficos y excluye etiquetas de estado conocidas."""
    author_names = book_authors.merge(authors[["author_id", "name"]], on="author_id", how="left").groupby("book_id").name.agg(lambda x: " ".join(sorted(set(x.dropna()))))
    thematic = book_genres[~book_genres.genre.str.lower().isin(SOCIAL_SHELF_LABELS)].groupby("book_id").genre.agg(lambda x: " ".join(sorted(set(x.dropna()))))
    frame = books[["book_id", "title", "description", "language_code"]].copy()
    frame["authors_text"] = frame.book_id.map(author_names).astype("string").fillna("")
    frame["genres_text"] = frame.book_id.map(thematic).astype("string").fillna("")
    for column in ("title", "description", "language_code"):
        frame[column] = frame[column].fillna("").astype(str)
    # Repetir título conserva una señal corta cuando no existe descripción.
    frame["content_text"] = (
        (frame.title + " ") * 2 + frame.description + " " + frame.authors_text + " " + frame.genres_text + " " + frame.language_code
    ).str.replace(r"\s+", " ", regex=True).str.strip()
    return frame


def content_candidate_scores(
    candidates: pd.DataFrame,
    train: pd.DataFrame,
    book_idx_to_content_row: np.ndarray,
    matrix: sparse.csr_matrix,
    positive_rating: float = 4,
    workers: int = 1,
) -> np.ndarray:
    """Puntúa candidatos con perfiles formados exclusivamente desde train."""
    positives = train[train.rating >= positive_rating].groupby("user_idx").book_idx.agg(list)
    scores = np.zeros(len(candidates), dtype=np.float32)
    groups = list(candidates.groupby("user_idx").groups.items())

    def score_user(user: int, positions: object) -> tuple[np.ndarray, np.ndarray]:
        profile_items = positives.get(user, [])
        rows = book_idx_to_content_row[np.asarray(profile_items, dtype=np.int64)] if profile_items else np.array([], dtype=np.int64)
        rows = rows[rows >= 0]
        if len(rows) == 0:
            return np.array([], dtype=np.int64), np.array([], dtype=np.float32)
        profile = normalize(sparse.csr_matrix(matrix[rows].mean(axis=0)))
        candidate_positions = np.asarray(list(positions), dtype=np.int64)
        candidate_rows = book_idx_to_content_row[candidates.loc[candidate_positions, "book_idx"].to_numpy(dtype=np.int64)]
        available = candidate_rows >= 0
        if available.any():
            return candidate_positions[available], (profile @ matrix[candidate_rows[available]].T).toarray().ravel().astype(np.float32)
        return np.array([], dtype=np.int64), np.array([], dtype=np.float32)

    if workers > 1:
        with ThreadPoolExecutor(max_workers=workers) as executor:
            results = executor.map(lambda group: score_user(*group), groups)
            for positions, values in results:
                scores[positions] = values
    else:
        for user, positions in groups:
            positions, values = score_user(user, positions)
            scores[positions] = values
    return scores
