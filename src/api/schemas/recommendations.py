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
    exclude_book_ids: list[str] = Field(default_factory=list, max_length=100_000)


class HistoricalHybridRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    goodreads_user_id: str = Field(min_length=1, max_length=128)
    limit: int = Field(default=10, ge=1, le=50)
    exclude_book_ids: list[str] = Field(default_factory=list, max_length=100_000)


class HistoricalRatingsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    goodreads_user_id: str = Field(min_length=1, max_length=128)
    limit: int = Field(default=20, ge=1, le=100)
    offset: int = Field(default=0, ge=0)


class HistoricalRating(BaseModel):
    goodreads_book_id: str
    title: str | None = None
    authors: list[str] = Field(default_factory=list)
    genres: list[str] = Field(default_factory=list)
    rating: int = Field(ge=1, le=5)


class HistoricalRatingsResponse(BaseModel):
    source: str = "goodreads_train"
    model_version: str = "v2"
    total: int
    positive_count: int
    limit: int
    offset: int
    data: list[HistoricalRating]


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
    model_signature: str | None = None
    recommendation_type: str
    model_version: str
    count: int
    recommendations: list[RecommendationItem]


class HealthResponse(BaseModel):
    status: str
    ready: bool
