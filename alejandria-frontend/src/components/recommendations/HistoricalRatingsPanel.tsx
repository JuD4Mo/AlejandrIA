import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { endpoints } from "@/api/endpoints";
import { useAuth } from "@/auth/AuthProvider";
import { LoadMore } from "@/components/LoadMore";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageLoader } from "@/components/ui/Loading";
import { Stars } from "@/components/ui/Stars";
import { es, interpolate } from "@/i18n/es";

export function HistoricalRatingsPanel() {
  const { user } = useAuth();
  const query = useInfiniteQuery({
    queryKey: ["ratings", "historical", user?.id],
    queryFn: ({ pageParam }) => endpoints.personalization.historicalRatings({ limit: 20, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (page) => {
      const next = page.offset + page.data.length;
      return page.data.length > 0 && next < page.total ? next : undefined;
    },
    retry: false,
    staleTime: 300_000,
  });
  if (query.isPending) return <PageLoader label={es.common.loading} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const summary = query.data.pages[0];
  const ratings = query.data.pages.flatMap((page) => page.data);
  return (
    <section aria-label={es.personalization.historicalRatingsTab}>
      <p className="notice notice--warning mb-4">{es.personalization.historicalRatingsNotice}</p>
      <p className="mb-4 text-sm text-fg-subtle">
        {interpolate(es.personalization.historicalRatingsSummary, { total: summary.total, positive: summary.positive_count })}
      </p>
      {ratings.length === 0 ? <EmptyState title={es.personalization.noHistoricalRatings} /> : (
        <div className="ratings-ledger">
          {ratings.map((rating) => (
            <article key={rating.goodreads_book_id} className="ratings-entry flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                {rating.local_book_id != null ? (
                  <Link to={`/books/${rating.local_book_id}`} className="font-display text-xl font-semibold text-fg no-underline hover:text-accent">
                    {rating.title || `Goodreads #${rating.goodreads_book_id}`}
                  </Link>
                ) : <p className="font-display text-xl font-semibold">{rating.title || `Goodreads #${rating.goodreads_book_id}`}</p>}
                {rating.authors.length > 0 && <p className="mt-1 text-sm text-fg-subtle">{rating.authors.join(", ")}</p>}
                <Stars value={rating.rating} readOnly size="sm" />
              </div>
              <span className="text-xs text-fg-subtle">{es.personalization.historicalRatingSource}</span>
            </article>
          ))}
        </div>
      )}
      {query.hasNextPage && <LoadMore onClick={() => void query.fetchNextPage()} loading={query.isFetchingNextPage} label={es.common.loadMore} />}
    </section>
  );
}
