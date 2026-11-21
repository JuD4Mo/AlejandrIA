import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { endpoints } from "@/api/endpoints";
import { useAuth } from "@/auth/AuthProvider";
import { es, interpolate } from "@/i18n/es";
import { recommendationErrorKind } from "@/lib/recommendations";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageLoader } from "@/components/ui/Loading";
import { RecommendationGrid } from "./RecommendationGrid";
import { Button } from "@/components/ui/Button";

export function ForYouRecommendations({ limit = 6 }: { limit?: number }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const queryKey = ["recommendations", "me", user?.id, limit];
  const query = useQuery({
    queryKey,
    queryFn: () => endpoints.personalization.recommendations(limit),
    enabled: Boolean(user?.id),
    retry: false,
    staleTime: 60_000,
    refetchInterval: (query) => {
      if (query.state.error && recommendationErrorKind(query.state.error) === "forbidden") return false;
      const status = query.state.data?.fold_in?.status;
      if (status === "error") return 5000;
      return ["pending", "processing", "stale"].includes(status ?? "") ? 2000 : false;
    },
  });

  const refresh = useMutation({
    mutationFn: () => endpoints.personalization.refreshRecommendations(
      limit, query.data?.recommendations.map((item) => item.goodreads_book_id) ?? [],
    ),
    onSuccess: (data) => queryClient.setQueryData(queryKey, data),
  });
  const regenerate = () => refresh.mutate();
  const isFetching = query.isFetching || refresh.isPending;
  const error = refresh.error ?? query.error;
  const isError = refresh.isError || query.isError;
  const errorKind = isError ? recommendationErrorKind(error) : null;
  const foldIn = query.data?.fold_in;
  let content;

  if (query.isPending && !isError) {
    content = <PageLoader label={es.recommendations.generating} />;
  } else if (isError && (!query.data || errorKind === "forbidden")) {
    if (errorKind === "forbidden") {
      content = (
        <EmptyState
          title={es.recommendations.forbiddenTitle}
          body={es.recommendations.forbiddenBody}
        />
      );
    } else if (errorKind === "no_similar") {
      content = (
        <EmptyState
          title={es.recommendations.noSimilar}
          body={es.recommendations.noSimilarBody}
        />
      );
    } else {
      content = <ErrorState error={error} className="recommendation-error" />;
    }
  } else if (query.data) {
    content = (
      <>
        {(query.isRefetchError || refresh.isError) && (
          <div className="space-y-2">
            <ErrorState error={error} compact />
            <p className="text-[0.84rem] text-fg-subtle">
              {es.recommendations.previousResults}
            </p>
          </div>
        )}
        <RecommendationGrid response={query.data} />
      </>
    );
  }

  return (
    <div className="space-y-4">
      {foldIn && errorKind !== "forbidden" && (
        <p role="status" className="notice mb-2">
          {foldIn.status === "ready" && query.data?.profile_origin === "local_fold_in"
            ? es.recommendations.foldInReady
            : ["pending", "processing", "stale"].includes(foldIn.status)
              ? es.recommendations.foldInUpdating
              : foldIn.status === "error"
                ? es.recommendations.foldInRetry
                : foldIn.reason === "positive_content_required"
                  ? es.recommendations.foldInPositiveRequired
                  : interpolate(es.recommendations.foldInInsufficient, { matched: foldIn.matched_count, minimum: foldIn.minimum_ratings })}
        </p>
      )}
      {query.data?.profile_origin === "goodreads_test" && errorKind !== "forbidden" && (
        <p role="status" className="notice notice--warning">
          {es.recommendations.historicalTestProfile}
        </p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl text-[0.82rem] leading-relaxed text-fg-subtle">
          {es.recommendations.regenerateHint}
        </p>
        <Button
          variant="secondary"
          className="shrink-0"
          onClick={regenerate}
          disabled={isFetching}
          aria-busy={isFetching}
        >
          {isFetching && (
            <span
              className="size-4 animate-spin rounded-full border border-current border-t-transparent"
              aria-hidden="true"
            />
          )}
          {isFetching
            ? es.recommendations.generating
            : es.recommendations.generateNew}
        </Button>
      </div>
      <div className="space-y-4" aria-busy={isFetching} aria-live="polite">
        {content}
      </div>
    </div>
  );
}
