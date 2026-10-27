"""Aplicación FastAPI para servir artefactos de recomendación ya entrenados."""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from typing import Callable

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from api.config import Settings
from api.routes.health import router as health_router
from api.routes.recommendations import router as recommendations_router
from ml.inference import RecommendationEngine


LOGGER = logging.getLogger(__name__)
EngineLoader = Callable[..., RecommendationEngine]


def create_app(settings: Settings | None = None, engine_loader: EngineLoader = RecommendationEngine) -> FastAPI:
    """Crea una aplicación con una única carga del motor durante su lifespan."""
    settings = settings or Settings.from_environment()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.engine = None
        app.state.ready = False
        app.state.initialization_error = None
        try:
            LOGGER.info("Cargando motor version=%s device=%s", settings.model_version, settings.device)
            app.state.engine = engine_loader(root=settings.root, device=settings.device, version=settings.model_version)
            app.state.ready = True
            LOGGER.info("Motor de recomendaciones listo")
        except Exception:
            app.state.initialization_error = "initialization_failed"
            LOGGER.exception("No se pudo cargar el motor de recomendaciones")
        yield
        app.state.engine = None
        app.state.ready = False

    app = FastAPI(
        title="Biblioteca Recommendation API",
        version="1.0.0",
        description="Servicio HTTP para los artefactos ya entrenados del recomendador V2.",
        lifespan=lifespan,
    )
    if settings.cors_origins:
        app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins), allow_credentials=False, allow_methods=["GET", "POST"], allow_headers=["*"])

    @app.middleware("http")
    async def request_log(request: Request, call_next):
        """Registra método, ruta, estado y duración; nunca cuerpos ni preferencias."""
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            LOGGER.exception("Solicitud fallida método=%s ruta=%s", request.method, request.url.path)
            raise
        LOGGER.info("Solicitud método=%s ruta=%s estado=%s duración_ms=%.1f", request.method, request.url.path, response.status_code, (time.perf_counter() - started) * 1000)
        return response

    app.include_router(health_router, prefix="/api/v1")
    app.include_router(recommendations_router, prefix="/api/v1")
    return app


app = create_app()
