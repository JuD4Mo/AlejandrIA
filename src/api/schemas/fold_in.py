"""Contratos privados de adaptación local, sin IDs de usuario histórico o local."""

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat


class LocalRating(BaseModel):
    model_config = ConfigDict(extra="forbid")
    book_id: str = Field(min_length=1, max_length=128)
    rating: int = Field(ge=1, le=5, strict=True)


class LocalProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model_signature: str = Field(pattern=r"^[0-9a-f]{64}$")
    input_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    vector: list[FiniteFloat] = Field(min_length=1, max_length=1024)
    bias: FiniteFloat
    positive_book_ids: list[str] = Field(min_length=1, max_length=100_000)


class FitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_signature: str = Field(pattern=r"^[0-9a-f]{64}$")
    ratings: list[LocalRating] = Field(max_length=100_000)


class LocalHybridRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    profile: LocalProfile
    limit: int = Field(default=10, ge=1, le=50)
    exclude_book_ids: list[str] = Field(default_factory=list, max_length=100_000)
