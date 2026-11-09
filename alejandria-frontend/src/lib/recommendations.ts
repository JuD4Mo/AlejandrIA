import { ApiError } from "@/api/client";
import type { RecommendationResponse } from "@/api/types";

export type RecommendationViewState =
  | { kind: "ok"; response: RecommendationResponse }
  | { kind: "preferences_required" }
  | { kind: "no_content_matches" }
  | { kind: "empty" };

export type RecommendationErrorKind =
  | "service_unavailable"
  | "timeout"
  | "bad_gateway"
  | "no_similar"
  | "forbidden"
  | "error";

export function recommendationViewState(
  response: RecommendationResponse,
): RecommendationViewState {
  if (response.status === "preferences_required") {
    return { kind: "preferences_required" };
  }
  if (response.status === "no_content_matches") {
    return { kind: "no_content_matches" };
  }
  if (response.count === 0 || response.recommendations.length === 0) {
    return { kind: "empty" };
  }
  return { kind: "ok", response };
}

export function recommendationErrorKind(error: unknown): RecommendationErrorKind {
  if (!(error instanceof ApiError)) return "error";
  if (error.status === 503) return "service_unavailable";
  if (error.status === 504) return "timeout";
  if (error.status === 502) return "bad_gateway";
  if (error.status === 404 || error.status === 409) return "no_similar";
  if (error.status === 403) return "forbidden";
  return "error";
}

export function isSimilarEmptyError(error: unknown): boolean {
  return recommendationErrorKind(error) === "no_similar";
}
