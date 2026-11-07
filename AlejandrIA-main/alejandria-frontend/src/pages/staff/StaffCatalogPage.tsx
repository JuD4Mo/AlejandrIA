import { useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ApiError } from "@/api/client";
import { endpoints } from "@/api/endpoints";
import type { NamedEntity, NamedKind } from "@/api/types";
import { LoadMore } from "@/components/LoadMore";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Cover } from "@/components/ui/Cover";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Field, Input } from "@/components/ui/Field";
import { PageLoader } from "@/components/ui/Loading";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { es } from "@/i18n/es";

const PAGE_SIZE = 20;
type Tab = "books" | NamedKind;

const namedTabs: { key: NamedKind; label: string }[] = [
  { key: "works", label: es.staff.catalogTabs.works },
  { key: "authors", label: es.staff.catalogTabs.authors },
  { key: "genres", label: es.staff.catalogTabs.genres },
];

function namedLabel(kind: NamedKind): string {
  if (kind === "works") return es.staff.namedForm.workName;
  if (kind === "authors") return es.staff.namedForm.authorName;
  return es.staff.namedForm.genreName;
}

function namedCreateLabel(kind: NamedKind): string {
  if (kind === "works") return es.staff.namedForm.createWork;
  if (kind === "authors") return es.staff.namedForm.createAuthor;
  return es.staff.namedForm.createGenre;
}

export function StaffCatalogPage() {
  useDocumentTitle(es.routeTitles.staffCatalog);
  const [tab, setTab] = useState<Tab>("books");
  return (
    <div>
      <PageHeader
        title={es.staff.catalogTitle}
        description={es.staff.catalogIntro}
        actions={
          tab === "books" ? (
            <Button asChild>
              <Link to="/staff/catalog/books/new">{es.staff.newBook}</Link>
            </Button>
          ) : undefined
        }
      />
      <div
        role="tablist"
        aria-label={es.staff.catalogTitle}
        className="mb-6 flex flex-wrap gap-1 border-b border-[rgba(243,240,250,0.16)]"
      >
        {[{ key: "books" as Tab, label: es.staff.catalogTabs.books }, ...namedTabs].map(
          (item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              onClick={() => setTab(item.key)}
              className={
                tab === item.key
                  ? "border-b-2 border-oxblood px-3 py-2 text-[0.86rem] font-semibold text-oxblood"
                  : "border-b-2 border-transparent px-3 py-2 text-[0.86rem] font-semibold text-[rgba(243,240,250,0.6)] hover:text-ink"
              }
            >
              {item.label}
            </button>
          ),
        )}
      </div>
      <div role="tabpanel">
        {tab === "books" ? <BooksPanel /> : <NamedPanel key={tab} kind={tab} />}
      </div>
    </div>
  );
}

function BooksPanel() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  const query = useInfiniteQuery({
    queryKey: ["books", "staff", applied],
    queryFn: ({ pageParam }) =>
      endpoints.books.list({
        limit: PAGE_SIZE,
        offset: pageParam,
        title: applied || undefined,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.data.length === PAGE_SIZE ? allPages.length * PAGE_SIZE : undefined,
    retry: 0,
  });

  const books = useMemo(() => {
    const seen = new Set<number>();
    return (query.data?.pages ?? []).flatMap((page) =>
      page.data.filter((book) => {
        if (seen.has(book.id)) return false;
        seen.add(book.id);
        return true;
      }),
    );
  }, [query.data]);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => endpoints.books.remove(id),
    onMutate: () => {
      setActionError(null);
      setMessage(null);
    },
    onSuccess: () => {
      setMessage(es.common.deleted);
      void queryClient.invalidateQueries({ queryKey: ["books"] });
    },
    onError: (error) => {
      if (
        error instanceof ApiError &&
        (error.status === 400 || error.status === 409)
      ) {
        setActionError({
          status: error.status,
          message: es.staff.deleteBookBlocked,
        });
      } else {
        setActionError(error);
      }
    },
  });

  return (
    <div>
      {message ? (
        <p
          role="status"
          className="mb-4 border-l-2 border-[#637a68] bg-[rgba(51,69,59,0.08)] px-4 py-3 text-[0.86rem] text-[#2c4034]"
        >
          {message}
        </p>
      ) : null}
      {actionError ? (
        <div className="mb-4">
          {typeof actionError === "object" &&
          actionError !== null &&
          "status" in actionError &&
          (actionError as { status: number }).status === 400 ||
          (actionError as { status: number }).status === 409 ? (
            <p
              role="alert"
              className="border-l-2 border-oxblood bg-[rgba(107,32,36,0.06)] px-4 py-3 text-[0.86rem] text-oxblood"
            >
              {es.staff.deleteBookBlocked}
            </p>
          ) : (
            <ErrorState error={actionError} compact />
          )}
        </div>
      ) : null}

      <form
        className="mb-4 flex flex-wrap items-end gap-2 border border-[rgba(243,240,250,0.14)] bg-[rgba(21,21,30,0.6)] p-3"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied(search.trim());
        }}
      >
        <Field label={es.catalog.searchLabel} htmlFor="staff-book-search" className="min-w-56 flex-1">
          <Input
            id="staff-book-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={es.catalog.searchPlaceholder}
          />
        </Field>
        <Button type="submit" variant="secondary">
          {es.common.search}
        </Button>
        {applied ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setSearch("");
              setApplied("");
            }}
          >
            {es.common.clear}
          </Button>
        ) : null}
      </form>

      {query.isPending ? (
        <PageLoader label={es.common.loading} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : books.length === 0 ? (
        <EmptyState
          title={es.catalog.noBooks}
          body={es.catalog.noBooksHint}
          action={
            <Button asChild>
              <Link to="/staff/catalog/books/new">{es.staff.newBook}</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="divide-y divide-[rgba(243,240,250,0.12)] border border-[rgba(243,240,250,0.14)]">
            {books.map((book) => (
              <article
                key={book.id}
                className="flex flex-wrap items-center gap-4 p-4"
              >
                <Cover title={book.title} size="sm" showInitial={false} />
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-[0.7rem] font-semibold text-[rgba(243,240,250,0.48)]">
                    #{book.id}
                  </p>
                  <h2 className="mt-0.5 font-display text-xl font-semibold">
                    {book.title}
                  </h2>
                  <p className="m-0 text-[0.78rem] text-[rgba(243,240,250,0.58)]">
                    {book.publication_year ?? "—"} · {book.language_code ?? "—"} ·{" "}
                    {book.authors.length} autoría(s) · {book.genre_ids.length} género(s)
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="secondary">
                    <Link to={`/staff/catalog/books/${book.id}/copies`}>
                      {es.staff.copiesTitle.replace("{{title}}", book.title)}
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="secondary">
                    <Link to={`/staff/catalog/books/${book.id}/edit`}>
                      {es.common.edit}
                    </Link>
                  </Button>
                  <ConfirmDialog
                    trigger={
                      <Button size="sm" variant="danger">
                        {es.common.delete}
                      </Button>
                    }
                    title={es.staff.deleteBookConfirm.replace(
                      "{{title}}",
                      book.title,
                    )}
                    destructive
                    onConfirm={() => deleteMutation.mutateAsync(book.id)}
                    loading={
                      deleteMutation.isPending &&
                      deleteMutation.variables === book.id
                    }
                  />
                </div>
              </article>
            ))}
          </div>
          {query.hasNextPage ? (
            <LoadMore
              onClick={() => void query.fetchNextPage()}
              loading={query.isFetchingNextPage}
              label={es.common.loadMore}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function NamedPanel({ kind }: { kind: NamedKind }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [goodreads, setGoodreads] = useState("");
  const [editing, setEditing] = useState<NamedEntity | null>(null);
  const [editName, setEditName] = useState("");
  const [editGoodreads, setEditGoodreads] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  const query = useInfiniteQuery({
    queryKey: ["named", kind, "staff"],
    queryFn: ({ pageParam }) =>
      endpoints.named.list(kind, { limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.data.length === PAGE_SIZE ? allPages.length * PAGE_SIZE : undefined,
    retry: 0,
  });

  const entities = useMemo(() => {
    const seen = new Set<number>();
    return (query.data?.pages ?? []).flatMap((page) =>
      page.data.filter((entity) => {
        if (seen.has(entity.id)) return false;
        seen.add(entity.id);
        return true;
      }),
    );
  }, [query.data]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["named", kind] });
    if (kind !== "genres") {
      void queryClient.invalidateQueries({ queryKey: ["books"] });
    } else {
      void queryClient.invalidateQueries({ queryKey: ["preferences"] });
      void queryClient.invalidateQueries({ queryKey: ["recommendations"] });
    }
  };

  const inputFor = (value: string) =>
    kind === "works" ? { title: value } : { name: value };

  const createMutation = useMutation({
    mutationFn: () =>
      endpoints.named.create(kind, {
        ...inputFor(name.trim()),
        goodreads_id:
          kind === "genres" || !goodreads.trim() ? null : goodreads.trim(),
      }),
    onMutate: () => {
      setActionError(null);
      setMessage(null);
    },
    onSuccess: () => {
      setMessage(es.staff.created);
      setName("");
      setGoodreads("");
      invalidate();
    },
    onError: (error) => setActionError(error),
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      endpoints.named.update(kind, editing?.id ?? 0, {
        ...inputFor(editName.trim()),
        goodreads_id:
          kind === "genres" || !editGoodreads.trim()
            ? null
            : editGoodreads.trim(),
      }),
    onMutate: () => {
      setActionError(null);
      setMessage(null);
    },
    onSuccess: () => {
      setMessage(es.staff.updated);
      setEditing(null);
      invalidate();
    },
    onError: (error) => setActionError(error),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => endpoints.named.remove(kind, id),
    onMutate: () => {
      setActionError(null);
      setMessage(null);
    },
    onSuccess: () => {
      setMessage(es.common.deleted);
      invalidate();
    },
    onError: (error) => setActionError(error),
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div>
        {message ? (
          <p
            role="status"
            className="mb-4 border-l-2 border-[#637a68] bg-[rgba(51,69,59,0.08)] px-4 py-3 text-[0.86rem] text-[#2c4034]"
          >
            {message}
          </p>
        ) : null}
        {actionError ? (
          <div className="mb-4">
            <ErrorState error={actionError} compact />
          </div>
        ) : null}
        {query.isPending ? (
          <PageLoader label={es.common.loading} />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : entities.length === 0 ? (
          <EmptyState title={es.common.none} />
        ) : (
          <>
            <div className="divide-y divide-[rgba(243,240,250,0.12)] border border-[rgba(243,240,250,0.14)]">
              {entities.map((entity) => (
                <div
                  key={entity.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-3"
                >
                  <div className="min-w-0">
                    <p className="m-0 font-display text-lg font-semibold">
                      {entity.value}
                    </p>
                    <p className="m-0 text-[0.72rem] text-[rgba(243,240,250,0.5)]">
                      #{entity.id}
                      {entity.goodreads_id
                        ? ` · Goodreads ${entity.goodreads_id}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(entity);
                        setEditName(entity.value);
                        setEditGoodreads(entity.goodreads_id ?? "");
                      }}
                    >
                      {es.common.edit}
                    </Button>
                    <ConfirmDialog
                      trigger={
                        <Button size="sm" variant="danger">
                          {es.common.delete}
                        </Button>
                      }
                      title={es.staff.deleteNamedConfirm.replace(
                        "{{name}}",
                        entity.value,
                      )}
                      destructive
                      onConfirm={() => deleteMutation.mutateAsync(entity.id)}
                      loading={
                        deleteMutation.isPending &&
                        deleteMutation.variables === entity.id
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
            {query.hasNextPage ? (
              <LoadMore
                onClick={() => void query.fetchNextPage()}
                loading={query.isFetchingNextPage}
                label={es.common.loadMore}
              />
            ) : null}
          </>
        )}
      </div>

      <form
        className="h-fit space-y-3 border border-[rgba(243,240,250,0.14)] bg-[rgba(21,21,30,0.6)] p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) createMutation.mutate();
        }}
      >
        <h2 className="font-display text-xl font-semibold">
          {namedCreateLabel(kind)}
        </h2>
        <Field label={namedLabel(kind)} htmlFor={`new-${kind}`} required>
          <Input
            id={`new-${kind}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </Field>
        {kind !== "genres" ? (
          <Field
            label={es.staff.namedForm.goodreads}
            htmlFor={`new-${kind}-goodreads`}
            hint={es.staff.namedForm.goodreadsHint}
          >
            <Input
              id={`new-${kind}-goodreads`}
              value={goodreads}
              onChange={(event) => setGoodreads(event.target.value)}
              inputMode="numeric"
            />
          </Field>
        ) : null}
        <Button
          type="submit"
          loading={createMutation.isPending}
          disabled={!name.trim()}
          className="w-full"
        >
          {namedCreateLabel(kind)}
        </Button>
      </form>

      <Modal
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        title={
          editing
            ? `${es.common.edit}: ${editing.value}`
            : es.common.edit
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              {es.common.cancel}
            </Button>
            <Button
              loading={updateMutation.isPending}
              disabled={!editName.trim()}
              onClick={() => updateMutation.mutate()}
            >
              {es.common.save}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={namedLabel(kind)} htmlFor="edit-named" required>
            <Input
              id="edit-named"
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
            />
          </Field>
          {kind !== "genres" ? (
            <Field
              label={es.staff.namedForm.goodreads}
              htmlFor="edit-named-goodreads"
              hint={es.staff.namedForm.goodreadsHint}
            >
              <Input
                id="edit-named-goodreads"
                value={editGoodreads}
                onChange={(event) => setEditGoodreads(event.target.value)}
                inputMode="numeric"
              />
            </Field>
          ) : null}
          {updateMutation.isError ? (
            <ErrorState error={updateMutation.error} compact />
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
