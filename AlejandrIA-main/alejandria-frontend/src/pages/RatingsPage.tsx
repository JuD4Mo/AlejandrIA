import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { endpoints } from "@/api/endpoints";
import { LibrarySpines } from "@/components/LibrarySpines";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadMore } from "@/components/LoadMore";
import { PageLoader } from "@/components/ui/Loading";
import { PageHeader } from "@/components/ui/PageHeader";
import { Stars } from "@/components/ui/Stars";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { es } from "@/i18n/es";
import { formatDateTime } from "@/lib/dates";
import { useState } from "react";
import "./account-library.css";

const PAGE_SIZE = 20;

export function RatingsPage() {
  useDocumentTitle(es.routeTitles.ratings);
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  const ratingsQuery = useInfiniteQuery({
    queryKey: ["ratings", "me", "list"],
    queryFn: ({ pageParam }) =>
      endpoints.personalization.ratings({
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.data.length === PAGE_SIZE
        ? allPages.length * PAGE_SIZE
        : undefined,
  });

  const removeMutation = useMutation({
    mutationFn: (bookId: number) =>
      endpoints.personalization.deleteRating(bookId),
    onMutate: () => {
      setActionError(null);
      setMessage(null);
    },
    onSuccess: () => {
      setMessage(es.personalization.ratingRemoved);
      void queryClient.invalidateQueries({ queryKey: ["ratings"] });
      void queryClient.invalidateQueries({ queryKey: ["recommendations"] });
    },
    onError: (error) => setActionError(error),
  });

  const ratings = (ratingsQuery.data?.pages ?? []).flatMap((page) => page.data);

  return (
    <div className="ratings-page mx-auto max-w-4xl">
      <PageHeader
        title={es.personalization.ratingsTitle}
        description={es.personalization.ratingsIntro}
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link to="/catalog">{es.personalization.browseCatalog}</Link>
          </Button>
        }
      />
      <LibrarySpines />

      {message ? (
        <p
          role="status"
          className="library-success mb-4"
        >
          {message}
        </p>
      ) : null}
      {actionError ? (
        <div className="mb-4">
          <ErrorState error={actionError} compact className="library-action-error" />
        </div>
      ) : null}

      {ratingsQuery.isPending ? (
        <PageLoader label={es.common.loading} />
      ) : ratingsQuery.isError ? (
        <ErrorState
          error={ratingsQuery.error}
          onRetry={() => void ratingsQuery.refetch()}
        />
      ) : ratings.length === 0 ? (
        <EmptyState
          title={es.personalization.noRatings}
          body={es.personalization.noRatingsHint}
          className="library-empty"
          action={
            <Button asChild variant="secondary">
              <Link to="/catalog">{es.personalization.browseCatalog}</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="ratings-ledger divide-y divide-[rgba(243,240,250,0.12)]">
            {ratings.map((rating) => (
              <article
                key={rating.book_id}
                className="ratings-entry flex flex-wrap items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <Link
                    to={`/books/${rating.book_id}`}
                    className="font-display text-xl font-semibold text-ink no-underline hover:text-oxblood"
                  >
                    {rating.title}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-3">
                    <Stars value={rating.rating} readOnly size="sm" />
                    <span className="text-[0.75rem] text-[rgba(243,240,250,0.56)]">
                      {formatDateTime(rating.updated_at)}
                    </span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={
                    removeMutation.isPending &&
                    removeMutation.variables === rating.book_id
                  }
                  onClick={() => removeMutation.mutate(rating.book_id)}
                >
                  {es.personalization.removeRating}
                </Button>
              </article>
            ))}
          </div>
          {ratingsQuery.hasNextPage ? (
            <LoadMore
              onClick={() => void ratingsQuery.fetchNextPage()}
              loading={ratingsQuery.isFetchingNextPage}
              label={es.common.loadMore}
              note={es.common.morePages}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
