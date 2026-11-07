import { useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { endpoints } from "@/api/endpoints";
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
import { es } from "@/i18n/es";
import { interpolate } from "@/i18n/es";
import "./catalog.css";

const PAGE_SIZE = 20;

export function CatalogPage() {
  useDocumentTitle(es.routeTitles.catalog);
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const titleParam = searchParams.get("title") ?? "";
  const authorParam = Number(searchParams.get("author_id") ?? 0);
  const genreParam = Number(searchParams.get("genre_id") ?? 0);
  const [title, setTitle] = useState(titleParam);
  const [view, setView] = useState<"shelf" | "list">(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "list"
      : "shelf",
  );

  const filters = useMemo(
    () => ({
      title: titleParam.trim() || undefined,
      author_id: authorParam > 0 ? authorParam : undefined,
      genre_id: genreParam > 0 ? genreParam : undefined,
    }),
    [titleParam, authorParam, genreParam],
  );

  const booksQuery = useInfiniteQuery({
    queryKey: ["books", "catalog", filters],
    queryFn: ({ pageParam }) =>
      endpoints.books.list({ ...filters, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.data.length === PAGE_SIZE
        ? lastPage.pagination.offset + PAGE_SIZE
        : undefined,
  });

  const authorsQuery = useQuery({
    queryKey: ["named", "authors", "options"],
    queryFn: () => endpoints.named.list("authors", { limit: 100 }),
    staleTime: 5 * 60_000,
  });
  const genresQuery = useQuery({
    queryKey: ["named", "genres", "options"],
    queryFn: () => endpoints.named.list("genres", { limit: 100 }),
    staleTime: 5 * 60_000,
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

  const updateParam = (key: string, value: string) => {
    if (key === "title") setTitle(value);
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  const hasFilters = Boolean(titleParam || authorParam || genreParam);

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
        className="catalog-search mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_auto] lg:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          updateParam("title", title.trim());
        }}
        role="search"
      >
        <Field label={es.catalog.searchLabel} htmlFor="catalog-title">
          <Input
            id="catalog-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={es.catalog.searchPlaceholder}
          />
        </Field>
        <Field label={es.catalog.authorLabel} htmlFor="catalog-author">
          <Select
            id="catalog-author"
            value={authorParam || ""}
            onChange={(event) => updateParam("author_id", event.target.value)}
          >
            <option value="">{es.catalog.allAuthors}</option>
            {(authorsQuery.data?.data ?? []).map((author) => (
              <option key={author.id} value={author.id}>
                {author.value}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={es.catalog.genreLabel} htmlFor="catalog-genre">
          <Select
            id="catalog-genre"
            value={genreParam || ""}
            onChange={(event) => updateParam("genre_id", event.target.value)}
          >
            <option value="">{es.catalog.allGenres}</option>
            {(genresQuery.data?.data ?? []).map((genre) => (
              <option key={genre.id} value={genre.id}>
                {genre.value}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex gap-2">
          <Button type="submit">{es.common.search}</Button>
          {hasFilters ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setTitle("");
                setSearchParams({}, { replace: true });
              }}
            >
              {es.catalog.clearFilters}
            </Button>
          ) : null}
        </div>
      </form>

      {booksQuery.isPending ? (
        <PageLoader label={es.common.loadingLong} />
      ) : booksQuery.isError ? (
        <ErrorState
          error={booksQuery.error}
          onRetry={() => void booksQuery.refetch()}
        />
      ) : books.length === 0 ? (
        <EmptyState
          title={es.catalog.noBooks}
          body={es.catalog.noBooksHint}
          className="catalog-empty"
          action={
            hasFilters ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setTitle("");
                  setSearchParams({}, { replace: true });
                }}
              >
                {es.catalog.clearFilters}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <p className="mb-3 font-tabular text-[0.78rem] text-[rgba(243,240,250,0.55)]">
            {interpolate(es.catalog.resultsCount, { count: books.length })}
          </p>
          <div className="sticky top-[4.5rem] z-10 mb-3 flex items-center justify-between border-b border-[rgba(232,228,216,0.28)] bg-baize py-2">
            <p className="m-0 text-sm text-ficha">Estantería de Alejandría</p>
            <div className="flex gap-1" role="group" aria-label="Vista del catálogo">
              <button type="button" aria-pressed={view === "shelf"} onClick={() => setView("shelf")} className={view === "shelf" ? "bg-brass px-3 py-1 text-sm text-ink" : "px-3 py-1 text-sm text-ficha hover:bg-[rgba(232,228,216,0.12)]"}>Estantería</button>
              <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")} className={view === "list" ? "bg-brass px-3 py-1 text-sm text-ink" : "px-3 py-1 text-sm text-ficha hover:bg-[rgba(232,228,216,0.12)]"}>Lista</button>
            </div>
          </div>
          <Shelf books={books} view={view} />
          {booksQuery.hasNextPage ? (
            <LoadMore
              onClick={() => void booksQuery.fetchNextPage()}
              loading={booksQuery.isFetchingNextPage}
              label={es.catalog.loadMore}
              note={es.common.morePages}
            />
          ) : (
            <p className="mt-6 border-t border-[rgba(243,240,250,0.14)] pt-4 text-center text-[0.78rem] text-[rgba(243,240,250,0.52)]">
              {es.common.noMoreResults}
            </p>
          )}
        </>
      )}
    </div>
  );
}
