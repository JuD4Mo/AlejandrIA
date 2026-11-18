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
import { useFavorites } from "@/hooks/useFavorites";
import { useNamedLabels } from "@/hooks/useNamedLabels";
import { es, interpolate } from "@/i18n/es";
import { genreLabel } from "@/lib/genres";
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
  const workQuery = useQuery({
    queryKey: ["named", "works", book?.work_id ?? 0],
    queryFn: () => endpoints.named.get("works", book?.work_id as number),
    enabled: Boolean(book?.work_id),
    staleTime: 5 * 60_000,
    retry: 0,
  });
  const { favorites, toggle: favoriteMutation } = useFavorites(reader);
  const isFavorite = favorites.has(bookId);

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
      void queryClient.invalidateQueries({ queryKey: ["books", bookId] });
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
  const authorLinks = book.authors.map((author) => {
    const label = authors.labels.get(author.author_id);
    const name = label ?? `#${author.author_id}`;
    return {
      id: author.author_id,
      name,
      text: author.role && author.role !== "author" ? `${name} (${author.role})` : name,
    };
  });
  const genreLinks = genreIds.flatMap((genreId) => {
    const name = genres.labels.get(genreId);
    return name ? [{ id: genreId, raw: name, label: genreLabel(name) }] : [];
  });
  const genreNames = genreLinks.map((genre) => genre.raw);
  // A record without any physical copy cannot be requested or reserved (409).
  const noCopies = !book.has_copies;
  const allBusy = book.has_copies && !book.has_available_copies;

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
          <p className="m-0 text-center text-[0.75rem] leading-snug text-fg-subtle">
            {es.common.snapshot}
          </p>
        </div>

        <div className="min-w-0">
          <p className="m-0 text-[0.95rem] text-fg-muted">
            {authorLinks.length
              ? authorLinks.map((author, index) => (
                  <span key={author.id}>
                    {index > 0 ? ", " : null}
                    <Link
                      to={`/catalog?author_id=${author.id}`}
                      title={interpolate(es.book.authorFilterLink, { name: author.name })}
                      className="font-semibold text-fg underline decoration-brass/60 underline-offset-4 hover:text-accent"
                    >
                      {author.text}
                    </Link>
                  </span>
                ))
              : es.book.unknownAuthor}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {genreLinks.map((genre) => (
              <Link
                key={genre.id}
                to={`/catalog?genre_id=${genre.id}`}
                className="chip"
                title={interpolate(es.book.genreFilterLink, { name: genre.label })}
              >
                {genre.label}
              </Link>
            ))}
            {reader ? (
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={isFavorite}
                loading={favoriteMutation.isPending}
                onClick={() =>
                  favoriteMutation.mutate(
                    { bookId, favorite: !isFavorite },
                    {
                      onSuccess: () =>
                        setActionMessage(isFavorite ? es.book.favoriteRemoved : es.book.favoriteAdded),
                      onError: (error) => setActionError(error),
                    },
                  )
                }
              >
                <span aria-hidden="true" className={isFavorite ? "text-lamp" : undefined}>
                  {isFavorite ? "♥" : "♡"}
                </span>
                {isFavorite ? es.book.favoriteRemove : es.book.favoriteAdd}
              </Button>
            ) : null}
          </div>

          <dl className="mt-6 grid gap-x-8 gap-y-3 border-y border-line py-4 text-[0.85rem] sm:grid-cols-2">
            {[
              [es.book.year, book.publication_year],
              [es.book.language, book.language_code],
              [es.book.pages, book.num_pages],
              [es.book.isbn, book.isbn],
              [es.book.isbn13, book.isbn13],
              [es.book.work, book.work_id ? (workQuery.data?.value ?? `#${book.work_id}`) : null],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex justify-between gap-4">
                <dt className="text-fg-subtle">{label}</dt>
                <dd className="m-0 text-right font-tabular text-fg">
                  {value ?? "—"}
                </dd>
              </div>
            ))}
          </dl>

          <section className="mt-6">
            <h2 className="font-display text-2xl font-semibold text-fg">
              {es.book.description}
            </h2>
            <p className="mt-2 max-w-2xl whitespace-pre-line text-[0.92rem] leading-relaxed text-fg-muted">
              {book.description ?? es.book.noDescription}
            </p>
          </section>

          <section className="mt-8 border-t border-line pt-6">
            <h2 className="font-display text-2xl font-semibold text-fg">
              {es.book.availability}
            </h2>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-[0.95rem] text-fg">
              <StatusBadge tone={noCopies ? "neutral" : allBusy ? "warn" : "good"}>
                {noCopies
                  ? es.book.noCopies
                  : interpolate(es.book.availableOf, {
                      available: book.available_copies,
                      total: book.total_copies,
                    })}
              </StatusBadge>
              {book.has_copies && (book.loaned_copies || book.reserved_copies || book.non_circulating_copies) ? (
                <span className="text-[0.8rem] text-fg-subtle">
                  {interpolate(es.book.copiesBreakdown, {
                    loaned: book.loaned_copies,
                    reserved: book.reserved_copies,
                    nonCirculating: book.non_circulating_copies,
                  })}
                </span>
              ) : null}
            </p>
            <p className="mt-1 max-w-xl text-[0.78rem] leading-snug text-fg-subtle">
              {es.book.availabilityNote}
            </p>

            {reader ? (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => requestMutation.mutate()}
                  loading={requestMutation.isPending}
                  disabled={noCopies || pendingRequest || hasOverdue || hasTwoLoans}
                  title={
                    noCopies
                      ? es.book.noCopies
                      : pendingRequest
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
                  disabled={noCopies || activeReservation}
                  title={
                    noCopies
                      ? es.book.noCopies
                      : activeReservation
                      ? es.book.reserveDisabledAlready
                      : undefined
                  }
                >
                  {es.book.reserve}
                </Button>
              </div>
            ) : null}
            {reader && noCopies ? (
              <p className="notice notice--warning mt-3 max-w-2xl">{es.book.noPhysicalCopies}</p>
            ) : reader && (hasOverdue || hasTwoLoans || pendingRequest || activeReservation) ? (
              <p className="notice notice--warning mt-3 max-w-2xl">
                {pendingRequest
                  ? es.book.requestDisabledAlready
                  : activeReservation
                    ? es.book.reserveDisabledAlready
                    : hasOverdue
                      ? es.book.requestDisabledOverdue
                      : es.book.requestDisabledTwoLoans}
              </p>
            ) : null}
            {reader && allBusy && !activeReservation ? (
              <p className="mt-3 max-w-xl text-[0.82rem] text-fg-muted">{es.book.allBusyHint}</p>
            ) : null}
            {!noCopies ? (
              <p className="mt-2 max-w-xl text-[0.78rem] text-fg-subtle">
                {es.book.requestLoanHint} {es.book.reserveHint}
              </p>
            ) : null}
            {actionMessage ? (
              <p
                role="status"
                className="notice notice--success mt-3"
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
            <section className="mt-8 border-t border-line pt-6">
              <h2 className="font-display text-2xl font-semibold text-fg">
                {es.book.rateTitle}
              </h2>
              <p className="mt-1 max-w-xl text-[0.85rem] text-fg-subtle">
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
                  <span className="text-[0.8rem] text-fg-subtle">
                    {ratingMessage}
                  </span>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <section className="mt-12 border-t border-line pt-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-3xl font-semibold text-fg">
              {es.book.copiesTitle}
            </h2>
            <p className="mt-1 max-w-2xl text-[0.85rem] text-fg-subtle">
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
          <p className="mt-4 text-[0.88rem] text-fg-subtle">
            {es.book.copiesEmpty}
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto border border-line">
            <table className="w-full min-w-[34rem] border-collapse text-left text-[0.85rem]">
              <thead className="bg-wash text-[0.72rem] text-fg-subtle">
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
                    className="border-t border-line"
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

      <section className="mt-12 border-t border-line pt-6">
        <h2 className="font-display text-3xl font-semibold text-fg">
          {es.book.similarTitle}
        </h2>
        <p className="mt-1 max-w-2xl text-[0.85rem] text-fg-subtle">
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
