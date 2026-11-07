from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from api.config import Settings
from api.main import create_app


class FakeEngine:
    def _frame(self, model: str, scope: str | None = None) -> pd.DataFrame:
        data: dict[str, object] = {
            "book_id": ["00123"], "title": ["Libro de prueba"], "authors": ["Autora | Coautor"],
            "genres": ["Fantasy | Adventure"], "score": [np.float32(0.8)], "model": [model],
        }
        if scope:
            data.update({"score_scope": [scope], "availability": [scope], "content_score": [np.float32(0.7)], "collaborative_score": [np.nan] if scope == "content_only_catalog" else [np.float32(3.8)]})
        return pd.DataFrame(data)

    def recommend_new_user(self, preferences: dict[str, list[str]], k: int) -> pd.DataFrame:
        if preferences.get("keywords") == ["error"]:
            raise RuntimeError("no exponer")
        return self._frame("content_cold_start")

    def recommend_similar(self, book_id: str, k: int) -> pd.DataFrame:
        if book_id == "missing":
            raise KeyError(book_id)
        return self._frame("content_similar")

    def recommend_hybrid(self, user_id: str, k: int) -> pd.DataFrame:
        if user_id == "missing":
            raise KeyError(user_id)
        return self._frame("hybrid", "collaborative_catalog")

    def recommend_content_only(self, user_id: str, k: int) -> pd.DataFrame:
        if user_id == "no-positive":
            raise ValueError("sin ratings positivos")
        return self._frame("content_only", "content_only_catalog")

    def recommend_collaborative(self, user_id: str, k: int) -> pd.DataFrame:
        return self._frame("collaborative")


def app_with_fake_engine(counter: dict[str, int] | None = None):
    def loader(**_: object) -> FakeEngine:
        if counter is not None:
            counter["loads"] = counter.get("loads", 0) + 1
        return FakeEngine()

    return create_app(Settings(root=Path(".")), engine_loader=loader)


def test_liveness_readiness_and_single_lifespan_load() -> None:
    counter: dict[str, int] = {}
    with TestClient(app_with_fake_engine(counter)) as client:
        assert client.get("/api/v1/health/live").json() == {"status": "alive", "ready": False}
        assert client.get("/api/v1/health/ready").json() == {"status": "ready", "ready": True}
        assert client.get("/api/v1/recommendations/collaborative/u1").status_code == 200
        assert client.get("/api/v1/recommendations/collaborative/u1").status_code == 200
    assert counter == {"loads": 1}


def test_preferences_validation_and_json_serialization() -> None:
    with TestClient(app_with_fake_engine()) as client:
        invalid = client.post("/api/v1/recommendations/preferences", json={"preferences": {}, "limit": 0})
        assert invalid.status_code == 422
        response = client.post("/api/v1/recommendations/preferences", json={"preferences": {"keywords": ["magic"]}, "limit": 2})
    assert response.status_code == 200
    item = response.json()["recommendations"][0]
    assert item["book_id"] == "00123"
    assert item["authors"] == ["Autora", "Coautor"]
    assert item["score_scope"] == "content_catalog"


def test_not_found_internal_error_and_content_only_scope() -> None:
    with TestClient(app_with_fake_engine()) as client:
        assert client.get("/api/v1/recommendations/similar/missing").status_code == 404
        no_positive = client.get("/api/v1/recommendations/content-only/no-positive")
        assert no_positive.status_code == 422
        content_only = client.get("/api/v1/recommendations/content-only/u1")
        error = client.post("/api/v1/recommendations/preferences", json={"preferences": {"keywords": ["error"]}})
    assert content_only.json()["recommendations"][0]["score_scope"] == "content_only_catalog"
    assert content_only.json()["recommendations"][0]["collaborative_score"] is None
    assert error.status_code == 500
    assert error.json()["detail"] == "Error interno al generar recomendaciones."


def test_readiness_is_false_when_engine_initialization_fails() -> None:
    def broken_loader(**_: object) -> FakeEngine:
        raise RuntimeError("boom")

    with TestClient(create_app(Settings(root=Path(".")), engine_loader=broken_loader)) as client:
        assert client.get("/api/v1/health/live").status_code == 200
        assert client.get("/api/v1/health/ready").json()["ready"] is False
        assert client.get("/api/v1/recommendations/hybrid/u1").status_code == 503
