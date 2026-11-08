"""Punto de entrada local con un único worker por defecto."""

import uvicorn

from api.config import Settings


if __name__ == "__main__":
    settings = Settings.from_environment()
    uvicorn.run("api.main:app", host=settings.host, port=settings.port, workers=1)
