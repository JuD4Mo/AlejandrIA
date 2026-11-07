import { useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "@/api/client";
import { endpoints } from "@/api/endpoints";
import type { Copy, CopyInput, CopyStatus } from "@/api/types";
import { LoadMore } from "@/components/LoadMore";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Field, Input, Select } from "@/components/ui/Field";
import { PageLoader } from "@/components/ui/Loading";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { es } from "@/i18n/es";
import { mapApiError } from "@/lib/errors";

const PAGE_SIZE = 20;
const statuses: CopyStatus[] = [
  "circulating",
  "maintenance",
  "lost",
  "withdrawn",
];

export function StaffCopiesPage() {
  const { id } = useParams();
  const bookId = Number(id);
  const valid = Number.isInteger(bookId) && bookId > 0;
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Copy | null>(null);
  const [open, setOpen] = useState(false);
  const [inventoryCode, setInventoryCode] = useState("");
  const [status, setStatus] = useState<CopyStatus>("circulating");
  const [location, setLocation] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  const bookQuery = useQuery({
    queryKey: ["books", bookId],
    queryFn: () => endpoints.books.get(bookId),
    enabled: valid,
    retry: 0,
  });
  useDocumentTitle(
    bookQuery.data
      ? es.staff.copiesTitle.replace("{{title}}", bookQuery.data.title)
      : es.routeTitles.staffCopies,
  );

  const copiesQuery = useInfiniteQuery({
    queryKey: ["copies", bookId, "staff"],
    queryFn: ({ pageParam }) =>
      endpoints.copies.list(bookId, { limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    enabled: valid,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.copies.length === PAGE_SIZE
        ? allPages.length * PAGE_SIZE
        : undefined,
    retry: 0,
  });

  const copies = useMemo(
    () => (copiesQuery.data?.pages ?? []).flatMap((page) => page.copies),
    [copiesQuery.data],
  );
  const summary = copiesQuery.data?.pages[0];

  const openCreate = () => {
    setEditing(null);
    setInventoryCode("");
    setStatus("circulating");
    setLocation("");
    setOpen(true);
  };

  const openEdit = (copy: Copy) => {
    setEditing(copy);
    setInventoryCode(copy.inventory_code);
    setStatus(copy.status);
    setLocation(copy.location ?? "");
    setOpen(true);
  };

  const mutation = useMutation({
    mutationFn: (input: CopyInput) =>
      editing
        ? endpoints.copies.update(bookId, editing.id, input)
        : endpoints.copies.create(bookId, input),
    onMutate: () => setActionError(null),
    onSuccess: () => {
      setMessage(
        editing ? es.staff.copyUpdated : es.staff.copyCreated,
      );
      setOpen(false);
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ["copies"] });
      void queryClient.invalidateQueries({ queryKey: ["books"] });
    },
    onError: (error) => setActionError(error),
  });

  const busy =
    mutation.isError &&
    mutation.error instanceof ApiError &&
    ["copy has an active loan or ready reservation", "copy is not eligible"].includes(
      mutation.error.body?.message ?? "",
    );

  if (!valid || (bookQuery.isError && bookQuery.error instanceof ApiError && bookQuery.error.status === 404)) {
    return (
      <EmptyState
        title={es.book.notFound}
        action={
          <Button asChild variant="secondary">
            <Link to="/staff/catalog">{es.errors.goBack}</Link>
          </Button>
        }
      />
    );
  }
  if (bookQuery.isPending) return <PageLoader label={es.common.loading} />;
  if (bookQuery.isError)
    return <ErrorState error={bookQuery.error} onRetry={() => void bookQuery.refetch()} />;
  if (!bookQuery.data) return null;

  return (
    <div>
      <PageHeader
        title={es.staff.copiesTitle.replace("{{title}}", bookQuery.data.title)}
        description={es.staff.copiesIntro}
        back={{ to: "/staff/catalog", label: es.staff.catalogTitle }}
        actions={
          <Button
            onClick={openCreate}
          >
            {es.staff.addCopy}
          </Button>
        }
      />

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

      {summary ? (
        <p className="mb-4 font-tabular text-[0.82rem] text-[rgba(243,240,250,0.6)]">
          {es.book.availableOf
            .replace("{{available}}", String(summary.available))
            .replace("{{total}}", String(summary.total))}
        </p>
      ) : null}

      {copiesQuery.isPending ? (
        <PageLoader label={es.common.loading} />
      ) : copiesQuery.isError ? (
        <ErrorState
          error={copiesQuery.error}
          onRetry={() => void copiesQuery.refetch()}
        />
      ) : copies.length === 0 ? (
        <EmptyState
          title={es.staff.copiesEmpty}
          action={
            <Button onClick={openCreate}>{es.staff.addCopy}</Button>
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto border border-[rgba(243,240,250,0.14)]">
            <table className="w-full min-w-[42rem] border-collapse text-left text-[0.85rem]">
              <thead className="bg-[rgba(243,240,250,0.05)] text-[0.72rem] text-[rgba(243,240,250,0.56)]">
                <tr>
                  <th className="px-3 py-2 font-semibold">ID</th>
                  <th className="px-3 py-2 font-semibold">{es.staff.copyCode}</th>
                  <th className="px-3 py-2 font-semibold">{es.staff.copyStatus}</th>
                  <th className="px-3 py-2 font-semibold">{es.common.location}</th>
                  <th className="px-3 py-2 font-semibold">{es.common.actions}</th>
                </tr>
              </thead>
              <tbody>
                {copies.map((copy) => (
                  <tr key={copy.id} className="border-t border-[rgba(243,240,250,0.1)]">
                    <td className="px-3 py-2 font-tabular">{copy.id}</td>
                    <td className="px-3 py-2 font-tabular">{copy.inventory_code}</td>
                    <td className="px-3 py-2">
                      {es.circulation.copyStatus[copy.status]}
                    </td>
                    <td className="px-3 py-2">{copy.location ?? "—"}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge
                          tone={copy.available_for_circulation ? "good" : "neutral"}
                        >
                          {copy.available_for_circulation
                            ? es.staff.copyAvailable
                            : es.staff.copyUnavailable}
                        </StatusBadge>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openEdit(copy)}
                        >
                          {es.staff.editCopy}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {copiesQuery.hasNextPage ? (
            <LoadMore
              onClick={() => void copiesQuery.fetchNextPage()}
              loading={copiesQuery.isFetchingNextPage}
              label={es.staff.copiesLoadMore}
            />
          ) : null}
        </>
      )}

      <Modal
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setEditing(null);
        }}
        title={editing ? es.staff.editCopy : es.staff.addCopy}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {es.common.cancel}
            </Button>
            <Button
              loading={mutation.isPending}
              disabled={!inventoryCode.trim()}
              onClick={() =>
                mutation.mutate({
                  inventory_code: inventoryCode.trim(),
                  status,
                  location: location.trim() || null,
                })
              }
            >
              {es.staff.saveCopy}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={es.staff.copyCode} htmlFor="copy-code" required>
            <Input
              id="copy-code"
              value={inventoryCode}
              onChange={(event) => setInventoryCode(event.target.value)}
            />
          </Field>
          <Field label={es.staff.copyStatus} htmlFor="copy-status">
            <Select
              id="copy-status"
              value={status}
              onChange={(event) => setStatus(event.target.value as CopyStatus)}
            >
              {statuses.map((value) => (
                <option key={value} value={value}>
                  {es.circulation.copyStatus[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={es.common.location} htmlFor="copy-location">
            <Input
              id="copy-location"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
            />
          </Field>
          {busy ? (
            <p className="text-[0.84rem] text-oxblood">{es.staff.copyBusy}</p>
          ) : mutation.isError ? (
            <p className="text-[0.84rem] text-oxblood">
              {mapApiError(mutation.error).message}
            </p>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
