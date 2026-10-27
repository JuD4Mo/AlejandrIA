"""Configuración de la API desde variables de entorno."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def project_root() -> Path:
    """Resuelve el repositorio desde este módulo, no desde el directorio actual."""
    return Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Settings:
    """Opciones de ejecución de una única instancia del motor."""

    root: Path
    model_version: str = "v2"
    device: str = "cpu"
    host: str = "127.0.0.1"
    port: int = 8000
    cors_origins: tuple[str, ...] = ()

    @classmethod
    def from_environment(cls) -> "Settings":
        origins = tuple(origin.strip() for origin in os.getenv("RECOMMENDER_CORS_ORIGINS", "").split(",") if origin.strip())
        return cls(
            root=Path(os.getenv("RECOMMENDER_PROJECT_ROOT", project_root())).expanduser().resolve(),
            model_version=os.getenv("RECOMMENDER_MODEL_VERSION", "v2"),
            device=os.getenv("RECOMMENDER_DEVICE", "cpu"),
            host=os.getenv("RECOMMENDER_HOST", "127.0.0.1"),
            port=int(os.getenv("RECOMMENDER_PORT", "8000")),
            cors_origins=origins,
        )
