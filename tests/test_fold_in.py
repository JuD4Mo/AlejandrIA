from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest
import pandas as pd
import torch
import scipy.sparse as sp
import joblib
from sklearn.feature_extraction.text import TfidfVectorizer
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))
from ml.fold_in import solve_user_vector
from ml.collaborative import MatrixFactorization
from ml.inference import RecommendationEngine
from api.main import create_app
from api.config import Settings
from test_inference import build_engine_root


def test_fold_in_solves_regularized_mf_with_bias_without_modifying_items():
    items = np.array([[1, 0], [0, 1], [1, 1], [-1, 0], [0, -1]], dtype=np.float32)
    original = items.copy()
    ratings = np.array([5, 4, 5, 1, 2], dtype=np.float32)
    item_bias = np.array([0.2, -0.1, 0.3, 0, 0.1])
    vector, bias = solve_user_vector(items, item_bias, ratings, 3, 0.2)
    design = np.column_stack([items, np.ones(5)])
    coefficients = np.r_[vector, bias]
    gradient = design.T @ (design @ coefficients - (ratings - 3 - item_bias)) + 0.2 * coefficients
    assert np.allclose(gradient, 0, atol=1e-6)
    assert np.array_equal(items, original)
    assert np.mean((3 + item_bias + items @ vector + bias - ratings) ** 2) < np.mean((3 + item_bias - ratings) ** 2)
    reordered = solve_user_vector(items[::-1], item_bias[::-1], ratings[::-1], 3, 0.2)
    assert np.allclose(vector, reordered[0]) and np.isclose(bias, reordered[1])


def test_regularization_handles_underdetermined_and_rejects_invalid_inputs():
    vector, bias = solve_user_vector(np.ones((1, 32)), np.zeros(1), np.array([5]), 3, 1)
    assert vector.shape == (32,) and np.isfinite(vector).all() and np.isfinite(bias)
    with pytest.raises(ValueError):
        solve_user_vector(np.ones((1, 2)), np.zeros(1), np.array([np.nan]), 3, 1)
    with pytest.raises(ValueError):
        solve_user_vector(np.ones((1, 2)), np.zeros(1), np.array([5]), 3, 0)


def local_engine(root: Path) -> RecommendationEngine:
    build_engine_root(root, version="v2")
    collab, content = root / "artifacts/v2/collaborative_mf", root / "artifacts/v2/content_tfidf"
    ids = [f"b{i}" for i in range(8)]
    pd.DataFrame({"book_id": ids, "book_idx": range(8)}).to_parquet(collab / "book_mapping.parquet", index=False)
    pd.DataFrame({"book_id": ids, "title": ids}).to_parquet(root / "data/processed_v2/books.parquet", index=False)
    texts = ["fantasy magic book" if i % 2 else "poetry poem book" for i in range(8)]
    vectorizer = TfidfVectorizer().fit(texts)
    joblib.dump(vectorizer, content / "tfidf_vectorizer.joblib")
    sp.save_npz(content / "book_tfidf.npz", vectorizer.transform(texts))
    pd.DataFrame({"book_id": ids, "content_row": range(8)}).to_parquet(content / "content_book_mapping.parquet", index=False)
    config = {"num_users": 1, "num_items": 8, "factors": 2, "global_mean": 3.0}
    import json
    (collab / "config.json").write_text(json.dumps(config))
    model = MatrixFactorization(1, 8, 2, 3.0)
    with torch.no_grad():
        model.item_embedding.weight.copy_(torch.tensor([[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [0.5, 0.5], [-0.5, 0.5], [0.5, -0.5]]))
    torch.save({"state_dict": model.state_dict()}, collab / "best_model.pt")
    return RecommendationEngine(root, device="cpu", version="v2")


def local_ratings():
    return [{"book_id": f"b{i}", "rating": value} for i, value in enumerate([5, 4, 1, 2, 5])]


def test_profile_uses_all_explicit_ratings_and_isolated_local_parameters(tmp_path):
    engine = local_engine(tmp_path)
    originals = {name: value.clone() for name, value in engine.model.state_dict().items()}
    result = engine.fit_local_profile(local_ratings() + [{"book_id": "missing", "rating": 5}])
    assert result["status"] == "ready" and result["matched_count"] == 5 and result["input_count"] == 6
    assert result["positive_count"] == 3
    assert result["profile"] == engine.fit_local_profile(list(reversed(local_ratings())) + [{"book_id": "missing", "rating": 5}])["profile"]
    rows = engine.recommend_local_profile(result["profile"], 10, [r["book_id"] for r in local_ratings()])
    assert set(rows.book_id).issubset({"b5", "b6", "b7"}) and len(rows) > 0
    assert rows.collaborative_score.notna().all() and rows.content_score.notna().all()
    changed = local_ratings()
    changed[2]["rating"] = 5
    assert engine.fit_local_profile(changed)["profile"]["vector"] != result["profile"]["vector"]
    assert all(torch.equal(originals[name], value) for name, value in engine.model.state_dict().items())
    assert engine.fit_local_profile(local_ratings()[:4])["status"] == "insufficient"
    assert engine.fit_local_profile([{**r, "rating": 1} for r in local_ratings()])["reason"] == "positive_content_required"
    with pytest.raises(ValueError):
        engine.fit_local_profile(local_ratings() + [local_ratings()[0]])
    with pytest.raises(ValueError, match="mismatch"):
        engine.recommend_local_profile({**result["profile"], "model_signature": "0" * 64}, 3, [])


def test_private_fold_in_api_fits_and_scores_with_version_guard(tmp_path):
    engine = local_engine(tmp_path)
    app = create_app(Settings(root=tmp_path), engine_loader=lambda **kwargs: engine)
    with TestClient(app) as client:
        info = client.get("/api/v1/recommendations/local/model").json()
        body = {"expected_signature": info["model_signature"], "ratings": local_ratings()}
        result = client.post("/api/v1/recommendations/local/fit", json=body)
        assert result.status_code == 200 and result.json()["status"] == "ready"
        profile = result.json()["profile"]
        response = client.post("/api/v1/recommendations/local/hybrid", json={"profile": profile, "limit": 3, "exclude_book_ids": [r["book_id"] for r in local_ratings()]})
        assert response.status_code == 200 and response.json()["recommendation_type"] == "hybrid"
        assert response.json()["model_signature"] == info["model_signature"]
        assert client.post("/api/v1/recommendations/local/fit", json={**body, "expected_signature": "0" * 64}).status_code == 409
        assert client.post("/api/v1/recommendations/local/hybrid", json={"profile": {**profile, "model_signature": "0" * 64}}).status_code == 409
        assert client.post("/api/v1/recommendations/local/fit", json={**body, "ratings": [{"book_id": "b0", "rating": 0}]}).status_code == 422
        assert client.post("/api/v1/recommendations/local/fit", json={**body, "user_id": "forged"}).status_code == 422
