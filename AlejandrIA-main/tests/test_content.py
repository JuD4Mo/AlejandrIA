from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from ml.content import build_content_frame


def test_content_frame_uses_metadata_and_excludes_social_labels() -> None:
    books = pd.DataFrame({"book_id": ["b1"], "title": ["Título"], "description": ["Descripción"], "language_code": ["spa"]})
    relations = pd.DataFrame({"book_id": ["b1"], "author_id": ["a1"]})
    authors = pd.DataFrame({"author_id": ["a1"], "name": ["Autora"]})
    genres = pd.DataFrame({"book_id": ["b1", "b1"], "genre": ["poetry", "to-read"]})
    sources = pd.DataFrame({"book_id": ["b1"], "source_genre": ["poetry"]})
    text = build_content_frame(books, relations, authors, genres, sources).loc[0, "content_text"]
    assert "Autora" in text and "poetry" in text and "to-read" not in text


def test_content_frame_retains_title_when_description_is_missing() -> None:
    books = pd.DataFrame({"book_id": ["b1"], "title": ["Título"], "description": [None], "language_code": ["spa"]})
    empty_relations = pd.DataFrame({"book_id": pd.Series(dtype="str"), "author_id": pd.Series(dtype="str")})
    empty_authors = pd.DataFrame({"author_id": pd.Series(dtype="str"), "name": pd.Series(dtype="str")})
    empty_genres = pd.DataFrame({"book_id": pd.Series(dtype="str"), "genre": pd.Series(dtype="str")})
    empty_sources = pd.DataFrame({"book_id": pd.Series(dtype="str"), "source_genre": pd.Series(dtype="str")})
    text = build_content_frame(books, empty_relations, empty_authors, empty_genres, empty_sources).loc[0, "content_text"]
    assert text.count("Título") == 2 and "spa" in text
