"""Sondas de vida y preparación."""

from fastapi import APIRouter, Request, status

from api.schemas.recommendations import HealthResponse


router = APIRouter(tags=["health"])


@router.get("/health/live", response_model=HealthResponse)
def live() -> HealthResponse:
    """El proceso HTTP responde aunque el motor esté cargando o haya fallado."""
    return HealthResponse(status="alive", ready=False)


@router.get("/health/ready", response_model=HealthResponse)
def ready(request: Request) -> HealthResponse:
    """Informa si el motor V2 ya está disponible para peticiones."""
    if getattr(request.app.state, "ready", False):
        return HealthResponse(status="ready", ready=True)
    return HealthResponse(status="not_ready", ready=False)
