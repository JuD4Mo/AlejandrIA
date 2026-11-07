"""Contratos públicos de recomendaciones y preferencias."""

from __future__ import annotations

from math import isfinite

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Preferences(BaseModel):
    """Preferencias textuales para usuarios sin historial Goodreads."""

    model_config = ConfigDict(extra="forbid")
    genres: list[str] = Field(default_factory=list)
    authors: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)

    @field_validator("genres", "authors", "keywords")
    @classmethod
    def valid_terms(cls, values: list[str]) -> list[str]:
        if any(not value.strip() for value in values):
            raise ValueError("Las preferencias no pueden contener texto vacío.")
        return [value.strip() for value in values]

    @model_validator(mode="after")
    def non_empty(self) -> "Preferences":
        if not any((self.genres, self.authors, self.keywords)):
            raise ValueError("Debe indicar al menos una preferencia.")
        return self

    def as_engine_input(self) -> dict[str, list[str]]:
        return self.model_dump(exclude_none=True)


class PreferencesRequest(BaseModel):
    preferences: Preferences
    limit: int = Field(default=10, ge=1, le=50)


class RecommendationItem(BaseModel):
    book_id: str
    title: str | None = None
    authors: list[str] = Field(default_factory=list)
    genres: list[str] = Field(default_factory=list)
    score: float | None = None
    model: str
    score_scope: str | None = None
    availability: str | None = None
    content_score: float | None = None
    collaborative_score: float | None = None

    @field_validator("score", "content_score", "collaborative_score", mode="before")
    @classmethod
    def finite_score(cls, value: object) -> float | None:
        if value is None:
            return None
        try:
            number = float(value)
        except (TypeError, ValueError):
            return None
        return number if isfinite(number) else None


class RecommendationsResponse(BaseModel):
    recommendation_type: str
    model_version: str
    count: int
    recommendations: list[RecommendationItem]


class HealthResponse(BaseModel):
    status: str
    ready: bool
