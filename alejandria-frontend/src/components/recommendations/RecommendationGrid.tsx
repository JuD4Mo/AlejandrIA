import type { RecommendationResponse } from "@/api/types";
import { recommendationViewState } from "@/lib/recommendations";
import { es } from "@/i18n/es";
import { RecommendationCard } from "./RecommendationCard";
import { EmptyState } from "@/components/ui/EmptyState";

export function RecommendationGrid({
  response,
}: {
  response: RecommendationResponse;
}) {
  const state = recommendationViewState(response);
  if (state.kind === "preferences_required") {
    return (
      <EmptyState
        title={es.recommendations.preferencesRequiredTitle}
        body={es.recommendations.preferencesRequiredBody}
      />
    );
  }
  if (state.kind === "no_content_matches") {
    return (
      <EmptyState
        title={es.recommendations.noMatchesTitle}
        body={es.recommendations.noMatchesBody}
      />
    );
  }
  if (state.kind === "empty") {
    return (
      <EmptyState
        title={es.recommendations.emptyTitle}
        body={es.recommendations.emptyBody}
      />
    );
  }
  return (
    <div className="recommendation-cart" aria-label={es.home.recommendations}>
      <div className="recommendation-cart-handle" aria-hidden="true" />
      <div className="recommendation-cart-shelf">
      {state.response.recommendations.map((item) => (
        <RecommendationCard
          key={`${item.goodreads_book_id}-${item.local_book_id ?? "external"}`}
          item={item}
          className="min-w-[220px] max-w-[240px] shrink-0"
        />
      ))}
      </div>
    </div>
  );
}
