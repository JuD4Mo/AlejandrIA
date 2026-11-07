import { useEffect, useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "@/api/client";
import { endpoints } from "@/api/endpoints";
import { recordInteraction } from "@/api/interactions";
import type { Book } from "@/api/types";
import { useAuth } from "@/auth/AuthProvider";
import { canRead } from "@/auth/capabilities";
import { LoadMore } from "@/components/LoadMore";
import { RecommendationGrid } from "@/components/recommendations/RecommendationGrid";
import { Button } from "@/components/ui/Button";
import { Cover } from "@/components/ui/Cover";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageLoader } from "@/components/ui/Loading";
import { PageHeader } from "@/components/ui/PageHeader";
import { Stars } from "@/components/ui/Stars";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useNamedLabels } from "@/hooks/useNamedLabels";
import { es } from "@/i18n/es";
import { isOverdueDueAt } from "@/lib/dates";
import { mapApiError } from "@/lib/errors";
import { recommendationErrorKind } from "@/lib/recommendations";

const COPY_PAGE_SIZE = 20;

export function BookPage() {
  const { id } = useParams();
  const bookId = Number(id);
  const validId = Number.isInteger(bookId) && bookId > 0;
  const { user } = useAuth();
  const reader = canRead(user);
  const queryClient = useQueryClient();
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [ratingMessage, setRatingMessage] = useState<string | null>(null);

  const bookQuery = useQuery({
    queryKey: ["books", bookId],
    queryFn: () => endpoints.books.get(bookId),
    enabled: validId,
    retry: 0,
  });
  const book: Book | undefined = bookQuery.data;

  useDocumentTitle(book ? book.title : es.routeTitles.book);

  useEffect(() => {
    if (book && reader) recordInteraction(book.id, "view");
  }, [book, reader]);

  const authorIds = useMemo(
    () => book?.authors.map((author) => author.author_id) ?? [],
    [book],
  );
  const genreIds = useMemo(() => book?.genre_ids ?? [], [book]);
  const authors = useNamedLabels("authors", authorIds);
  const genres = useNamedLabels("genres", genreIds);

  const copiesQuery = useInfiniteQuery({
    queryKey: ["copies", bookId, "book-page"],
    queryFn: ({ pageParam }) =>
      endpoints.copies.list(bookId, {
        limit: COPY_PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    enabled: validId,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.copies.length === COPY_PAGE_SIZE
        ? allPages.length * COPY_PAGE_SIZE
        : undefined,
  });

  const similarQuery = useQuery({
    queryKey: ["similar", bookId],
    queryFn: () => endpoints.books.similar(bookId, 6),
    enabled: validId,
    retry: false,
    staleTime: 60_000,
  });

  const ratingsQuery = useQuery({
    queryKey: ["ratings", "me", 100],
    queryFn: () => endpoints.personalization.ratings({ limit: 100 }),
    enabled: reader,
    retry: 0,
  });
  const myRating = ratingsQuery.data?.data.find(
    (rating) => rating.book_id === bookId,
  );

  const loansQuery = useQuery({
    queryKey: ["circulation", "loans", "book-actions"],
    queryFn: () => endpoints.circulation.listLoans({ limit: 100 }),
    enabled: reader,
    retry: 0,
  });
  const requestsQuery = useQuery({
    queryKey: ["circulation", "requests", "book-actions"],
    queryFn: () => endpoints.circulation.listRequests({ limit: 100 }),
    enabled: reader,
    retry: 0,
  });
  const reservationsQuery = useQuery({
    queryKey: ["circulation", "reservations", "book-actions"],
    queryFn: () => endpoints.circulation.listReservations({ limit: 100 }),
    enabled: reader,
    retry: 0,
  });

  const myLoans = (loansQuery.data?.data ?? []).filter(
    (loan) => loan.user_id === user?.id && !loan.returned_at,
  );
  const hasOverdue = myLoans.some((loan) =>
    isOverdueDueAt(loan.due_at, loan.returned_at),
  );
  const hasTwoLoans = myLoans.length >= 2;
  const pendingRequest = (requestsQuery.data?.data ?? []).some(
    (request) =>
      request.user_id === user?.id &&
      request.book_id === bookId &&
      request.status === "pending",
  );
  const activeReservation = (reservationsQuery.data?.data ?? []).some(
    (reservation) =>
      reservation.user_id === user?.id &&
      reservation.book_id === bookId &&
      (reservation.status === "waiting" || reservation.status === "ready"),
  );

  const requestMutation = useMutation({
    mutationFn: () => endpoints.circulation.createRequest(bookId),
    onSuccess: () => {
      setActionError(null);
      setActionMessage(es.book.requestSuccess);
      void queryClient.invalidateQueries({ queryKey: ["circulation"] });
      void queryClient.invalidateQueries({ queryKey: ["recommendations"] });
    },
    onError: (error) => {
      setActionMessage(null);
      setActionError(error);
    },
  });

  const reserveMutation = useMutation({
    mutationFn: () => endpoints.circulation.reserve(bookId),
    onSuccess: () => {
      setActionError(null);
      setActionMessage(es.book.reserveSuccess);
      void queryClient.invalidateQueries({ queryKey: ["circulation"] });
    },
    onError: (error) => {
      setActionMessage(null);
      setActionError(error);
    },
  });

  const ratingMutation = useMutation({
    mutationFn: (rating: number) =>
      endpoints.personalization.putRating(bookId, { rating }),
    onSuccess: () => {
      setRatingMessage(es.book.ratingSaved);
      void queryClient.invalidateQueries({ queryKey: ["ratings"] });
      void queryClient.invalidateQueries({ queryKey: ["recommendations"] });
    },
    onError: (error) => {
      setRatingMessage(mapApiError(error).message);
    },
  });

  const removeRatingMutation = useMutation({
    mutationFn: () => endpoints.personalization.deleteRating(bookId),
    onSuccess: () => {
      setRatingMessage(es.book.ratingRemoved);
      void queryClient.invalidateQueries({ queryKey: ["ratings"] });
      void queryClient.invalidateQueries({ queryKey: ["recommendations"] });
    },
    onError: (error) => {
      setRatingMessage(mapApiError(error).message);
    },
  });

  if (!validId) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          title={es.book.notFound}
          body={es.book.notFoundHint}
          action={
            <Button asChild variant="secondary">
              <Link to="/catalog">{es.common.backToCatalog}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  if (bookQuery.isPending) return <PageLoader label={es.common.loadingLong} />;
  if (bookQuery.isError) {
    if (bookQuery.error instanceof ApiError && bookQuery.error.status === 404) {
      return (
        <div className="mx-auto max-w-3xl">
          <EmptyState
            title={es.book.notFound}
            body={es.book.notFoundHint}
            action={
              <Button asChild variant="secondary">
                <Link to="/catalog">{es.common.backToCatalog}</Link>
              </Button>
            }
          />
        </div>
      );
    }
    return <ErrorState error={bookQuery.error} onRetry={() => void bookQuery.refetch()} />;
  }
  if (!book) return null;

  const copies = (copiesQuery.data?.pages ?? []).flatMap((page) => page.copies);
  const summary = copiesQuery.data?.pages[0];
  const authorNames = authorIds
    .map((authorId) => {
      const label = authors.labels.get(authorId);
      const role = book.authors.find((author) => author.author_id === authorId)?.role;
      if (!label) return null;
      return role && role !== "author" ? `${label} (${role})` : label;
    })
    .filter((value): value is string => Boolean(value));
  const genreNames = genreIds
    .map((genreId) => genres.labels.get(genreId))
    .filter((value): value is string => Boolean(value));

  const similarState = similarQuery.isError
    ? recommendationErrorKind(similarQuery.error)
    : null;

  return (
    <div>
      <PageHeader
        title={book.title}
        back={{ to: "/catalog", label: es.book.backToCatalog }}
      />

      <div className="grid gap-8 lg:grid-cols-[240px_1fr] lg:items-start">
        <div className="flex flex-col items-center gap-4 lg:sticky lg:top-24">
          <Cover title={book.title} genres={genreNames} size="lg" />
          <p className="m-0 text-center text-[0.75rem] leading-snug text-[rgba(243,240,250,0.5)]">
            {es.common.snapshot}
          </p>
        </div>

        <div className="min-w-0">
          <p className="m-0 text-[0.82rem] text-[rgba(243,240,250,0.64)]">
            {authorNames.length ? authorNames.join(", ") : es.book.authors}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {genreNames.map((genre) => (
              <StatusBadge key={genre} tone="quiet">
                {genre}
              </StatusBadge>
            ))}
          </div>

          <dl className="mt-6 grid gap-x-8 gap-y-3 border-y border-[rgba(243,240,250,0.14)] py-4 text-[0.85rem] sm:grid-cols-2">
            {[
              [es.book.year, book.publication_year],
              [es.book.language, book.language_code],
              [es.book.pages, book.num_pages],
              [es.book.isbn, book.isbn],
              [es.book.isbn13, book.isbn13],
              [es.book.work, book.work_id],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex justify-between gap-4">
                <dt className="text-[rgba(243,240,250,0.54)]">{label}</dt>
                <dd className="m-0 text-right font-tabular text-ink">
                  {value ?? "—"}
                </dd>
              </div>
            ))}
          </dl>

          <section className="mt-6">
            <h2 className="font-display text-2xl font-semibold text-ink">
              {es.book.description}
            </h2>
            <p className="mt-2 max-w-2xl whitespace-pre-line text-[0.92rem] leading-relaxed text-[rgba(243,240,250,0.74)]">
              {book.description ?? es.book.noDescription}
            </p>
          </section>

          <section className="mt-8 border-t border-[rgba(243,240,250,0.14)] pt-6">
            <h2 className="font-display text-2xl font-semibold text-ink">
              {es.book.availability}
            </h2>
            {summary ? (
              <p className="mt-1 text-[0.9rem] text-[rgba(243,240,250,0.72)]">
                {summary.available === 0
                  ? es.book.allCopiesBusy
                  : es.book.availableOf
                      .replace("{{available}}", String(summary.available))
                      .replace("{{total}}", String(summary.total))}
              </p>
            ) : copiesQuery.isError ? (
              <p className="mt-1 text-[0.9rem] text-[rgba(243,240,250,0.62)]">
                {es.catalog.availabilityError}
              </p>
            ) : (
              <p className="mt-1 text-[0.9rem] text-[rgba(243,240,250,0.62)]">
                {es.catalog.availabilityLoading}
              </p>
            )}
            <p className="mt-1 max-w-xl text-[0.78rem] leading-snug text-[rgba(243,240,250,0.5)]">
              {es.book.availabilityNote}
            </p>

            {reader ? (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => requestMutation.mutate()}
                  loading={requestMutation.isPending}
                  disabled={
                    pendingRequest ||
                    hasOverdue ||
                    hasTwoLoans ||
                    !bookQuery.data
                  }
                  title={
                    pendingRequest
                      ? es.book.requestDisabledAlready
                      : hasOverdue
                        ? es.book.requestDisabledOverdue
                        : hasTwoLoans
                          ? es.book.requestDisabledTwoLoans
                          : undefined
                  }
                >
                  {es.book.requestLoan}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => reserveMutation.mutate()}
                  loading={reserveMutation.isPending}
                  disabled={activeReservation}
                  title={
                    activeReservation
                      ? es.book.reserveDisabledAlready
                      : undefined
                  }
                >
                  {es.book.reserve}
                </Button>
              </div>
            ) : null}
            {reader && (hasOverdue || hasTwoLoans || pendingRequest || activeReservation) ? (
              <p className="mt-2 text-[0.8rem] text-[rgba(243,240,250,0.68)]">
                {pendingRequest
                  ? es.book.requestDisabledAlready
                  : activeReservation
                    ? es.book.reserveDisabledAlready
                    : hasOverdue
                      ? es.book.requestDisabledOverdue
                      : es.book.requestDisabledTwoLoans}
              </p>
            ) : null}
            <p className="mt-2 max-w-xl text-[0.78rem] text-[rgba(243,240,250,0.52)]">
              {es.book.requestLoanHint} {es.book.reserveHint}
            </p>
            {actionMessage ? (
              <p
                role="status"
                className="mt-3 border-l-2 border-[#637a68] bg-[rgba(51,69,59,0.08)] px-3 py-2 text-[0.85rem] text-[#2c4034]"
              >
                {actionMessage}
              </p>
            ) : null}
            {actionError ? (
              <div className="mt-3">
                <ErrorState error={actionError} compact />
              </div>
            ) : null}
          </section>

          {reader ? (
            <section className="mt-8 border-t border-[rgba(243,240,250,0.14)] pt-6">
              <h2 className="font-display text-2xl font-semibold text-ink">
                {es.book.rateTitle}
              </h2>
              <p className="mt-1 max-w-xl text-[0.85rem] text-[rgba(243,240,250,0.64)]">
                {es.book.rateHint}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <Stars
                  value={myRating?.rating ?? 0}
                  disabled={ratingMutation.isPending || removeRatingMutation.isPending}
                  onChange={(rating) => ratingMutation.mutate(rating)}
                  size="lg"
                />
                {myRating ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={removeRatingMutation.isPending}
                    onClick={() => removeRatingMutation.mutate()}
                  >
                    {es.book.rateRemove}
                  </Button>
                ) : null}
                {ratingMessage ? (
                  <span className="text-[0.8rem] text-[rgba(243,240,250,0.62)]">
                    {ratingMessage}
                  </span>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <section className="mt-12 border-t border-[rgba(243,240,250,0.16)] pt-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-3xl font-semibold text-ink">
              {es.book.copiesTitle}
            </h2>
            <p className="mt-1 max-w-2xl text-[0.85rem] text-[rgba(243,240,250,0.62)]">
              {es.book.copiesIntro}
            </p>
          </div>
        </div>
        {copiesQuery.isPending ? (
          <PageLoader label={es.common.loading} />
        ) : copiesQuery.isError ? (
          <div className="mt-4">
            <ErrorState error={copiesQuery.error} compact />
          </div>
        ) : copies.length === 0 ? (
          <p className="mt-4 text-[0.88rem] text-[rgba(243,240,250,0.62)]">
            {es.book.copiesEmpty}
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto border border-[rgba(243,240,250,0.14)]">
            <table className="w-full min-w-[34rem] border-collapse text-left text-[0.85rem]">
              <thead className="bg-[rgba(243,240,250,0.05)] text-[0.72rem] text-[rgba(243,240,250,0.56)]">
                <tr>
                  <th className="px-3 py-2 font-semibold">{es.book.copyCode}</th>
                  <th className="px-3 py-2 font-semibold">{es.book.copyStatus}</th>
                  <th className="px-3 py-2 font-semibold">{es.book.copyLocation}</th>
                  <th className="px-3 py-2 font-semibold">{es.book.availability}</th>
                </tr>
              </thead>
              <tbody>
                {copies.map((copy) => (
                  <tr
                    key={copy.id}
                    className="border-t border-[rgba(243,240,250,0.1)]"
                  >
                    <td className="px-3 py-2 font-tabular">{copy.inventory_code}</td>
                    <td className="px-3 py-2">
                      {es.circulation.copyStatus[copy.status]}
                    </td>
                    <td className="px-3 py-2">{copy.location ?? "—"}</td>
                    <td className="px-3 py-2">
                      <StatusBadge tone={copy.available_for_circulation ? "good" : "neutral"}>
                        {copy.available_for_circulation
                          ? es.book.copyAvailable
                          : es.book.copyUnavailable}
                      </StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {copiesQuery.hasNextPage ? (
          <LoadMore
            onClick={() => void copiesQuery.fetchNextPage()}
            loading={copiesQuery.isFetchingNextPage}
            label={es.book.copiesLoadMore}
          />
        ) : null}
      </section>

      <section className="mt-12 border-t border-[rgba(243,240,250,0.16)] pt-6">
        <h2 className="font-display text-3xl font-semibold text-ink">
          {es.book.similarTitle}
        </h2>
        <p className="mt-1 max-w-2xl text-[0.85rem] text-[rgba(243,240,250,0.62)]">
          {es.book.similarIntro}
        </p>
        <div className="mt-4">
          {similarQuery.isPending ? (
            <PageLoader label={es.common.loadingLong} />
          ) : similarQuery.isError ? (
            similarState === "no_similar" ? (
              <EmptyState
                title={es.recommendations.noSimilar}
                body={es.recommendations.noSimilarBody}
              />
            ) : (
              <ErrorState
                error={similarQuery.error}
                onRetry={() => void similarQuery.refetch()}
              />
            )
          ) : similarQuery.data ? (
            <RecommendationGrid response={similarQuery.data} />
          ) : null}
        </div>
      </section>
    </div>
  );
}
