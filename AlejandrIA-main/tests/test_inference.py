from __future__ import annotations

import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import pytest
import scipy.sparse as sp
import torch
from sklearn.feature_extraction.text import TfidfVectorizer

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from ml.collaborative import MatrixFactorization
from ml.inference import RecommendationEngine
from ml.recommendation import minmax_values, weighted_hybrid_score


def build_engine_root(root: Path, version: str = "v1", positive_history: bool = True) -> None:
    suffix = "_v2" if version == "v2" else ""
    artifact_root = root / "artifacts" / "v2" if version == "v2" else root / "artifacts"
    ml, processed = root / "data" / f"ml{suffix}", root / "data" / f"processed{suffix}"
    collab, content, hybrid = artifact_root / "collaborative_mf", artifact_root / "content_tfidf", artifact_root / "hybrid"
    for directory in (ml, processed, collab, content, hybrid):
        directory.mkdir(parents=True, exist_ok=True)
    users = pd.DataFrame({"user_id": ["u1"], "user_idx": [0]})
    books = pd.DataFrame({"book_id": ["b2", "b0", "b1"], "book_idx": [2, 0, 1]})
    users.to_parquet(ml / "user_mapping.parquet", index=False); users.to_parquet(collab / "user_mapping.parquet", index=False)
    books.to_parquet(ml / "book_mapping.parquet", index=False); books.to_parquet(collab / "book_mapping.parquet", index=False)
    ratings = [5.0, 4.0] if positive_history else [2.0, 3.0]
    pd.DataFrame({"user_idx": [0, 0], "book_idx": [0, 1], "rating": ratings}).to_parquet(ml / "train.parquet", index=False)
    content_ids = ["b0", "b1", "b2"] + (["b3"] if version == "v2" else [])
    content_texts = ["poetry poem", "fiction novel", "comics graphic"] + (["poetry anthology"] if version == "v2" else [])
    titles = ["Poema", "Novela", "Cómic"] + (["Antología"] if version == "v2" else [])
    pd.DataFrame({"book_id": content_ids, "title": titles}).to_parquet(processed / "books.parquet", index=False)
    pd.DataFrame({"author_id": ["a"], "name": ["Autora"]}).to_parquet(processed / "authors.parquet", index=False)
    pd.DataFrame({"book_id": ["b0"], "author_id": ["a"]}).to_parquet(processed / "book_authors.parquet", index=False)
    pd.DataFrame({"book_id": content_ids, "genre": ["poetry", "fiction", "comics"] + (["poetry"] if version == "v2" else [])}).to_parquet(processed / "book_genres.parquet", index=False)
    vectorizer = TfidfVectorizer().fit(content_texts)
    matrix = vectorizer.transform(content_texts)
    joblib.dump(vectorizer, content / "tfidf_vectorizer.joblib"); sp.save_npz(content / "book_tfidf.npz", matrix)
    pd.DataFrame({"book_id": content_ids, "content_row": range(len(content_ids))}).to_parquet(content / "content_book_mapping.parquet", index=False)
    config = {"num_users": 1, "num_items": 3, "factors": 2, "global_mean": 3.0}
    (collab / "config.json").write_text(json.dumps(config), encoding="utf-8")
    model = MatrixFactorization(1, 3, 2, 3.0); torch.save({"state_dict": model.state_dict()}, collab / "best_model.pt")
    (hybrid / "config.json").write_text(json.dumps({"content_weight": 0.6}), encoding="utf-8")


def test_engine_resolves_mapping_and_excludes_known_items(tmp_path: Path) -> None:
    build_engine_root(tmp_path)
    engine = RecommendationEngine(tmp_path, device="cpu")
    recommendations = engine.recommend_collaborative("u1", k=1)
    assert recommendations.book_id.tolist() == ["b2"]
    assert engine.recommend_similar("b0", k=2).iloc[0].book_id != "b0"
    assert engine.recommend_hybrid("u1", k=1).book_id.tolist() == ["b2"]
    assert len(engine.recommend_new_user({"genres": ["poetry"]}, k=1)) == 1


def test_v2_hybrid_marks_items_without_collaborative_embedding(tmp_path: Path) -> None:
    build_engine_root(tmp_path, version="v2")
    engine = RecommendationEngine(tmp_path, device="cpu", version="v2")
    hybrid = engine.recommend_hybrid("u1", k=3)
    content_only = engine.recommend_content_only("u1", k=3)
    assert set(hybrid.availability) == {"collaborative_catalog"}
    assert set(content_only.availability) == {"content_only"}
    assert content_only.collaborative_score.isna().all()
    assert set(hybrid.book_id).isdisjoint(content_only.book_id)


def test_hybrid_uses_the_same_minmax_fusion_as_validation(tmp_path: Path) -> None:
    build_engine_root(tmp_path, version="v2")
    engine = RecommendationEngine(tmp_path, device="cpu", version="v2")
    user_idx = engine._user_idx("u1")
    candidates = engine._unknown_candidates(user_idx)
    result = engine.recommend_hybrid("u1", k=len(candidates)).sort_values("book_id")
    content = engine._content_scores_for_user(user_idx, candidates)
    collaborative = engine._collaborative_scores(user_idx, candidates)
    expected = weighted_hybrid_score(minmax_values(content), minmax_values(collaborative), 0.6)
    expected_by_book = dict(zip(engine._enrich(candidates, expected, "x").book_id, expected, strict=True))
    assert np.allclose(result.score.to_numpy(), [expected_by_book[book_id] for book_id in result.book_id])


def test_content_only_requires_positive_history_and_metadata_is_present(tmp_path: Path) -> None:
    build_engine_root(tmp_path, version="v2", positive_history=False)
    engine = RecommendationEngine(tmp_path, device="cpu", version="v2")
    fallback = engine.recommend_hybrid("u1", k=1)
    assert fallback.availability.tolist() == ["collaborative_catalog"]
    assert fallback.title.notna().all() and fallback.genres.notna().all()
    with pytest.raises(ValueError, match="ratings positivos"):
        engine.recommend_content_only("u1")
