"""Dependencias compartidas por las rutas HTTP."""

from __future__ import annotations

from typing import Protocol

from fastapi import HTTPException, Request, status


class RecommendationEngineProtocol(Protocol):
    """Contrato mínimo para desacoplar rutas HTTP del motor concreto."""

    def recommend_collaborative(self, user_id: str, k: int): ...
    def recommend_similar(self, book_id: str, k: int): ...
    def recommend_hybrid(self, user_id: str, k: int): ...
    def recommend_content_only(self, user_id: str, k: int): ...
    def recommend_new_user(self, preferences: dict[str, list[str]], k: int): ...


def get_engine(request: Request) -> RecommendationEngineProtocol:
    """Entrega la única instancia lista; nunca inicializa artefactos por petición."""
    engine = getattr(request.app.state, "engine", None)
    if not getattr(request.app.state, "ready", False) or engine is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Motor de recomendaciones no disponible.")
    return engine
