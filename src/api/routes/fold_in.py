"""Adaptación de perfiles locales con vectores de ítems inmutables."""

import logging

from fastapi import APIRouter, Depends, HTTPException

from api.dependencies import get_engine
from api.schemas.fold_in import FitRequest, LocalHybridRequest
from api.schemas.recommendations import RecommendationsResponse
from api.routes.recommendations import response_from_frame

LOGGER = logging.getLogger(__name__)
router = APIRouter(prefix="/recommendations/local", tags=["local-fold-in"])


@router.get("/model")
def local_model(engine=Depends(get_engine)):
    return engine.local_model_info()


@router.post("/fit")
def fit_local(payload: FitRequest, engine=Depends(get_engine)):
    if payload.expected_signature != engine.local_model_info()["model_signature"]:
        raise HTTPException(status_code=409, detail="fold_in_model_mismatch")
    try:
        return engine.fit_local_profile([rating.model_dump() for rating in payload.ratings])
    except ValueError:
        raise HTTPException(status_code=422, detail="Valoraciones locales incompatibles.") from None
    except Exception:
        LOGGER.exception("Error al adaptar perfil local")
        raise HTTPException(status_code=500, detail="No se pudo adaptar el perfil local.") from None


@router.post("/hybrid", response_model=RecommendationsResponse)
def local_hybrid(payload: LocalHybridRequest, engine=Depends(get_engine)):
    if payload.profile.model_signature != engine.local_model_info()["model_signature"]:
        raise HTTPException(status_code=409, detail="fold_in_model_mismatch")
    try:
        frame = engine.recommend_local_profile(payload.profile.model_dump(), payload.limit, payload.exclude_book_ids)
        response = response_from_frame(frame, "hybrid", "collaborative_catalog")
        response.model_signature = payload.profile.model_signature
        return response
    except ValueError:
        raise HTTPException(status_code=422, detail="Perfil local incompatible.") from None
    except Exception:
        LOGGER.exception("Error al recomendar con perfil local")
        raise HTTPException(status_code=500, detail="No se pudo utilizar el perfil local.") from None
