"""Endpoints de inferencia, sin conocimiento de PyTorch ni TF-IDF."""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from typing import Annotated

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, status

from api.dependencies import RecommendationEngineProtocol, get_engine
from api.schemas.recommendations import PreferencesRequest, RecommendationItem, RecommendationsResponse


LOGGER = logging.getLogger(__name__)
router = APIRouter(prefix="/recommendations", tags=["recommendations"])
Limit = Annotated[int, Query(ge=1, le=50, description="Número máximo de libros.")]
Engine = Annotated[RecommendationEngineProtocol, Depends(get_engine)]


def split_metadata(value: object) -> list[str]:
    """Convierte el texto agregado del motor a un arreglo estable para el contrato."""
    if value is None or pd.isna(value):
        return []
    return [part.strip() for part in str(value).split("|") if part.strip()]


def nullable_float(value: object) -> float | None:
    if value is None or pd.isna(value):
        return None
    number = float(value)
    return number if np.isfinite(number) else None


def response_from_frame(frame: pd.DataFrame, recommendation_type: str, default_scope: str | None = None) -> RecommendationsResponse:
    """Serializa valores pandas/NumPy y nunca expone NaN en JSON."""
    items = []
    for row in frame.to_dict(orient="records"):
        row_scope = row.get("score_scope")
        items.append(RecommendationItem(
            book_id=str(row["book_id"]),
            title=None if pd.isna(row.get("title")) else str(row.get("title")),
            authors=split_metadata(row.get("authors")),
            genres=split_metadata(row.get("genres")),
            score=nullable_float(row.get("score")),
            model=str(row.get("model", recommendation_type)),
            score_scope=default_scope if row_scope is None or pd.isna(row_scope) else str(row_scope),
            availability=None if pd.isna(row.get("availability")) else str(row.get("availability")),
            content_score=nullable_float(row.get("content_score")),
            collaborative_score=nullable_float(row.get("collaborative_score")),
        ))
    return RecommendationsResponse(recommendation_type=recommendation_type, model_version="v2", count=len(items), recommendations=items)


def execute(operation: str, recommendation_type: str, call: Callable[[], pd.DataFrame], scope: str | None = None) -> RecommendationsResponse:
    """Convierte errores del motor a HTTP y registra solo operación/duración."""
    started = time.perf_counter()
    try:
        result = call()
    except KeyError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Identificador histórico no encontrado.") from None
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from None
    except HTTPException:
        raise
    except Exception:
        LOGGER.exception("Error interno en operación=%s", operation)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error interno al generar recomendaciones.") from None
    LOGGER.info("Operación=%s duración_ms=%.1f resultados=%d", operation, (time.perf_counter() - started) * 1000, len(result))
    return response_from_frame(result, recommendation_type, scope)


@router.post("/preferences", response_model=RecommendationsResponse)
def preferences(payload: PreferencesRequest, engine: Engine) -> RecommendationsResponse:
    return execute("preferences", "content", lambda: engine.recommend_new_user(payload.preferences.as_engine_input(), payload.limit), "content_catalog")


@router.get("/similar/{book_id}", response_model=RecommendationsResponse)
def similar(book_id: str, engine: Engine, limit: Limit = 10) -> RecommendationsResponse:
    return execute("similar", "similar", lambda: engine.recommend_similar(book_id, limit), "content_catalog")


@router.get("/hybrid/{goodreads_user_id}", response_model=RecommendationsResponse)
def hybrid(goodreads_user_id: str, engine: Engine, limit: Limit = 10) -> RecommendationsResponse:
    return execute("hybrid", "hybrid", lambda: engine.recommend_hybrid(goodreads_user_id, limit), "collaborative_catalog")


@router.get("/content-only/{goodreads_user_id}", response_model=RecommendationsResponse)
def content_only(goodreads_user_id: str, engine: Engine, limit: Limit = 10) -> RecommendationsResponse:
    return execute("content_only", "content_only", lambda: engine.recommend_content_only(goodreads_user_id, limit), "content_only_catalog")


@router.get("/collaborative/{goodreads_user_id}", response_model=RecommendationsResponse)
def collaborative(goodreads_user_id: str, engine: Engine, limit: Limit = 10) -> RecommendationsResponse:
    return execute("collaborative", "collaborative", lambda: engine.recommend_collaborative(goodreads_user_id, limit), "collaborative_catalog")
