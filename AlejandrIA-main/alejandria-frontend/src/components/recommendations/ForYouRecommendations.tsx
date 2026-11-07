import { useQuery } from "@tanstack/react-query";
import { endpoints } from "@/api/endpoints";
import { es } from "@/i18n/es";
import { recommendationErrorKind } from "@/lib/recommendations";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageLoader } from "@/components/ui/Loading";
import { RecommendationGrid } from "./RecommendationGrid";

export function ForYouRecommendations({ limit = 6 }: { limit?: number }) {
  const query = useQuery({
    queryKey: ["recommendations", "me", limit],
    queryFn: () => endpoints.personalization.recommendations(limit),
    retry: false,
    staleTime: 60_000,
  });

  if (query.isPending) return <PageLoader label={es.common.loadingLong} />;

  if (query.isError) {
    const kind = recommendationErrorKind(query.error);
    if (kind === "forbidden") {
      return (
        <EmptyState
          title={es.recommendations.forbiddenTitle}
          body={es.recommendations.forbiddenBody}
        />
      );
    }
    if (kind === "no_similar") {
      return (
        <EmptyState
          title={es.recommendations.noSimilar}
          body={es.recommendations.noSimilarBody}
        />
      );
    }
    return (
      <ErrorState
        error={query.error}
        onRetry={() => void query.refetch()}
        className="recommendation-error"
      />
    );
  }

  return <RecommendationGrid response={query.data} />;
}
