import { useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { endpoints, type BookFilters } from "@/api/endpoints";
import type { Book } from "@/api/types";
import { useAuth } from "@/auth/AuthProvider";
import { canStaff } from "@/auth/capabilities";
import { Shelf } from "@/components/Shelf";
import { LoadMore } from "@/components/LoadMore";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Field, Input, Select } from "@/components/ui/Field";
import { PageLoader } from "@/components/ui/Loading";
import { PageHeader } from "@/components/ui/PageHeader";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { es, interpolate } from "@/i18n/es";
import { cn } from "@/lib/cn";
import { genreLabel } from "@/lib/genres";
import "./catalog.css";

const PAGE_SIZE = 24;
type Availability = "" | "physical" | "now";

function availabilityFilter(value: Availability): Pick<BookFilters, "has_copies" | "available"> {
  if (value === "physical") return { has_copies: true };
  if (value === "now") return { available: true };
  return {};
}

function preferredView(): "shelf" | "list" {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "shelf";
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "list" : "shelf";
}

export function CatalogPage() {
  useDocumentTitle(es.routeTitles.catalog);
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const titleParam = searchParams.get("title") ?? "";
  const authorParam = Number(searchParams.get("author_id") ?? 0);
  const genreParam = Number(searchParams.get("genre_id") ?? 0);
  const availabilityRaw = searchParams.get("availability");
  const availabilityParam: Availability =
    availabilityRaw === "physical" || availabilityRaw === "now" ? availabilityRaw : "";
  const [title, setTitle] = useState(titleParam);
  const [view, setView] = useState<"shelf" | "list">(preferredView);

  const filters = useMemo<BookFilters>(
    () => ({
      title: titleParam.trim() || undefined,
      author_id: authorParam > 0 ? authorParam : undefined,
      genre_id: genreParam > 0 ? genreParam : undefined,
      ...availabilityFilter(availabilityParam),
    }),
    [titleParam, authorParam, genreParam, availabilityParam],
  );

  // Keyset pagination: the catalogue has ~931k records and deep OFFSETs are
  // slow (docs/database/importacion_goodreads.md §9), so follow next_after_id.
  const booksQuery = useInfiniteQuery({
    queryKey: ["books", "catalog", filters],
    queryFn: ({ pageParam }) =>
      endpoints.books.list({ ...filters, limit: PAGE_SIZE, after_id: pageParam }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.next_after_id ?? undefined,
  });

  const genresQuery = useQuery({
    queryKey: ["named", "genres", "options"],
    queryFn: () => endpoints.named.list("genres", { limit: 100 }),
    staleTime: 5 * 60_000,
  });
  // 268k authors cannot be a <select>; the filter comes from a book's author link.
  const authorQuery = useQuery({
    queryKey: ["named", "authors", authorParam],
    queryFn: () => endpoints.named.get("authors", authorParam),
    enabled: authorParam > 0,
    staleTime: 5 * 60_000,
    retry: 0,
  });

  const books: Book[] = useMemo(() => {
    const seen = new Set<number>();
    return (booksQuery.data?.pages ?? []).flatMap((page) =>
      page.data.filter((book) => {
        if (seen.has(book.id)) return false;
        seen.add(book.id);
        return true;
      }),
    );
  }, [booksQuery.data]);

  const genreOptions = useMemo(
    () =>
      (genresQuery.data?.data ?? [])
        .map((genre) => ({ id: genre.id, label: genreLabel(genre.value) }))
        .sort((a, b) => a.label.localeCompare(b.label, "es")),
    [genresQuery.data],
  );

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  const clearAll = () => {
    setTitle("");
    setSearchParams({}, { replace: true });
  };

  const hasFilters = Boolean(titleParam || authorParam || genreParam || availabilityParam);
  // The cursor page after a full page may be empty; only claim "more" when the
  // last response actually advanced the cursor.
  const lastPage = booksQuery.data?.pages.at(-1);
  const canLoadMore = booksQuery.hasNextPage && (lastPage?.data.length ?? 0) > 0;

  return (
    <div className="catalog-page">
      <PageHeader
        title={es.catalog.title}
        description={es.catalog.intro}
        className="catalog-heading"
        actions={
          canStaff(user) ? (
            <Button asChild variant="secondary" size="sm">
              <Link to="/staff/catalog">{es.nav.staffCatalog}</Link>
            </Button>
          ) : undefined
        }
      />

      <div className="catalog-book-frieze" aria-hidden="true">
        <span /><span /><span /><span /><span /><span /><span /><span /><span />
      </div>

      <form
        className="catalog-search mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_auto] lg:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          updateParam("title", title.trim());
        }}
        role="search"
      >
        <Field label={es.catalog.searchLabel} htmlFor="catalog-title">
          <Input
            id="catalog-title"
            type="search"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={es.catalog.searchPlaceholder}
          />
        </Field>
        <Field label={es.catalog.genreLabel} htmlFor="catalog-genre">
          <Select
            id="catalog-genre"
            value={genreParam || ""}
            onChange={(event) => updateParam("genre_id", event.target.value)}
          >
            <option value="">{es.catalog.allGenres}</option>
            {genreOptions.map((genre) => (
              <option key={genre.id} value={genre.id}>
                {genre.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={es.catalog.availabilityLabel} htmlFor="catalog-availability">
          <Select
            id="catalog-availability"
            value={availabilityParam}
            onChange={(event) => updateParam("availability", event.target.value)}
          >
            <option value="">{es.catalog.availabilityAll}</option>
            <option value="physical">{es.catalog.availabilityPhysical}</option>
            <option value="now">{es.catalog.availabilityNow}</option>
          </Select>
        </Field>
        <div className="flex gap-2">
          <Button type="submit">{es.common.search}</Button>
          {hasFilters ? (
            <Button type="button" variant="secondary" onClick={clearAll}>
              {es.catalog.clearFilters}
            </Button>
          ) : null}
        </div>
      </form>

      <div className="mb-8 flex min-h-8 flex-wrap items-center gap-2 text-[0.8rem] text-fg-subtle">
        {authorParam > 0 ? (
          <button
            type="button"
            className="chip"
            onClick={() => updateParam("author_id", "")}
            aria-label={es.catalog.authorChipRemove}
          >
            {interpolate(es.catalog.authorChip, {
              name: authorQuery.data?.value ?? `#${authorParam}`,
            })}
            <span aria-hidden="true">×</span>
          </button>
        ) : (
          <span>{es.catalog.authorFilterHint}</span>
        )}
      </div>

      {booksQuery.isPending ? (
        <PageLoader label={es.common.loadingLong} />
      ) : booksQuery.isError ? (
        <ErrorState error={booksQuery.error} onRetry={() => void booksQuery.refetch()} />
      ) : books.length === 0 ? (
        <EmptyState
          title={es.catalog.noBooks}
          body={es.catalog.noBooksHint}
          className="catalog-empty"
          action={
            hasFilters ? (
              <Button variant="secondary" onClick={clearAll}>
                {es.catalog.clearFilters}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="sticky top-[var(--header-h,4.4rem)] z-10 mb-3 flex items-center justify-between gap-3 border-b border-line-strong bg-baize py-2">
            <p className="m-0 font-tabular text-[0.8rem] text-fg-muted">
              {interpolate(es.catalog.shownCount, { count: books.length })}
            </p>
            <div className="flex gap-1" role="group" aria-label={es.catalog.viewLabel}>
              {(["shelf", "list"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={view === option}
                  onClick={() => setView(option)}
                  className={cn(
                    "px-3 py-1 text-sm",
                    view === option
                      ? "bg-brass text-ink"
                      : "text-ficha hover:bg-[rgba(232,228,216,0.12)]",
                  )}
                >
                  {option === "shelf" ? es.catalog.viewShelf : es.catalog.viewList}
                </button>
              ))}
            </div>
          </div>
          <Shelf books={books} view={view} />
          {canLoadMore ? (
            <LoadMore
              onClick={() => void booksQuery.fetchNextPage()}
              loading={booksQuery.isFetchingNextPage}
              label={es.catalog.loadMore}
              note={es.common.morePages}
            />
          ) : (
            <p className="mt-6 border-t border-line pt-4 text-center text-[0.78rem] text-fg-subtle">
              {es.common.noMoreResults}
            </p>
          )}
        </>
      )}
    </div>
  );
}
