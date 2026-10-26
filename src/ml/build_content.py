"""Construye artefactos TF-IDF V2 sin materializar similitudes densas."""

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
from scipy import sparse
from sklearn.feature_extraction.text import TfidfVectorizer

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).parents[1]))

from ml.content import build_content_frame


def process_rss_bytes() -> int:
    """Devuelve el RSS actual en Linux sin dependencia adicional."""
    for line in Path("/proc/self/status").read_text(encoding="utf-8").splitlines():
        if line.startswith("VmRSS:"):
            return int(line.split()[1]) * 1024
    return 0


def load_content_frame(processed_dir: Path, max_books: int | None = None) -> pd.DataFrame:
    """Carga solo columnas bibliográficas necesarias para el índice de contenido."""
    books = pd.read_parquet(processed_dir / "books.parquet", columns=["book_id", "title", "description", "language_code"])
    if max_books is not None:
        books = books.sort_values("book_id", kind="stable").head(max_books).copy()
    selected_ids = set(books.book_id)
    authors = pd.read_parquet(processed_dir / "authors.parquet", columns=["author_id", "name"])
    book_authors = pd.read_parquet(processed_dir / "book_authors.parquet", columns=["book_id", "author_id"])
    book_authors = book_authors[book_authors.book_id.isin(selected_ids)]
    book_genres = pd.read_parquet(processed_dir / "book_genres.parquet", columns=["book_id", "genre"])
    book_genres = book_genres[book_genres.book_id.isin(selected_ids)]
    # La firma conserva source_genres por compatibilidad, pero no lo incorpora como señal temática.
    source_genres = pd.DataFrame({"book_id": pd.Series(dtype="string"), "source_genre": pd.Series(dtype="string")})
    return build_content_frame(books, book_authors, authors, book_genres, source_genres)


def sparse_nbytes(matrix: sparse.spmatrix) -> int:
    """Cuenta los buffers que ocupan la representación CSR."""
    matrix = matrix.tocsr()
    return matrix.data.nbytes + matrix.indices.nbytes + matrix.indptr.nbytes


def build_content_artifacts(
    processed_dir: Path,
    output_dir: Path,
    *,
    max_books: int | None = None,
    min_df: int = 2,
    max_features: int = 80_000,
) -> dict[str, object]:
    """Ajusta TF-IDF y persiste matriz, vocabulario, mapping y auditoría."""
    started = time.perf_counter()
    frame = load_content_frame(processed_dir, max_books=max_books)
    vectorizer = TfidfVectorizer(
        lowercase=True,
        strip_accents="unicode",
        ngram_range=(1, 2),
        min_df=min_df,
        max_features=max_features,
        sublinear_tf=True,
        dtype=np.float32,
        norm="l2",
    )
    matrix = vectorizer.fit_transform(frame.content_text).tocsr()
    output_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(vectorizer, output_dir / "tfidf_vectorizer.joblib")
    sparse.save_npz(output_dir / "book_tfidf.npz", matrix, compressed=True)
    pd.DataFrame({"book_id": frame.book_id, "content_row": np.arange(len(frame), dtype=np.int64)}).to_parquet(
        output_dir / "content_book_mapping.parquet", index=False
    )
    config = {
        "ngram_range": [1, 2],
        "min_df": min_df,
        "max_features": max_features,
        "dtype": "float32",
        "fields": ["title", "description", "authors", "thematic_genres", "language_code"],
        "social_shelves_excluded": True,
        "max_books": max_books,
    }
    (output_dir / "config.json").write_text(json.dumps(config, indent=2, ensure_ascii=False), encoding="utf-8")
    summary = {
        "books": len(frame),
        "books_without_description": int(frame.description.eq("").sum()),
        "matrix_shape": list(matrix.shape),
        "matrix_nnz": int(matrix.nnz),
        "matrix_bytes": sparse_nbytes(matrix),
        "vocabulary_size": len(vectorizer.vocabulary_),
        "rss_bytes": process_rss_bytes(),
        "elapsed_seconds": time.perf_counter() - started,
        "pid": os.getpid(),
    }
    (output_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--processed-dir", type=Path, default=Path("data/processed_v2"))
    parser.add_argument("--output-dir", type=Path, default=Path("artifacts/v2/content_tfidf"))
    parser.add_argument("--max-books", type=int)
    parser.add_argument("--min-df", type=int, default=2)
    parser.add_argument("--max-features", type=int, default=80_000)
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    result = build_content_artifacts(
        args.processed_dir, args.output_dir, max_books=args.max_books, min_df=args.min_df, max_features=args.max_features
    )
    print(json.dumps(result, indent=2))
