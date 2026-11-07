import { useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { endpoints } from "@/api/endpoints";
import type { LoanRequestListRow } from "@/api/types";
import { LoadMore } from "@/components/LoadMore";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Field, Select, Textarea } from "@/components/ui/Field";
import { BookLabel, PageLoader } from "@/components/ui/Loading";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useBookTitles } from "@/hooks/useNamedLabels";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { es } from "@/i18n/es";
import { formatDateTime } from "@/lib/dates";
import { mapApiError } from "@/lib/errors";

const PAGE_SIZE = 20;

export function StaffRequestsPage() {
  useDocumentTitle(es.routeTitles.staffRequests);
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [deliverRow, setDeliverRow] = useState<LoanRequestListRow | null>(null);
  const [rejectRow, setRejectRow] = useState<LoanRequestListRow | null>(null);

  const query = useInfiniteQuery({
    queryKey: ["circulation", "requests", "staff"],
    queryFn: ({ pageParam }) =>
      endpoints.circulation.listRequests({ limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.data.length === PAGE_SIZE ? allPages.length * PAGE_SIZE : undefined,
    retry: 0,
  });

  const rows = useMemo(
    () => (query.data?.pages ?? []).flatMap((page) => page.data),
    [query.data],
  );
  const titles = useBookTitles(rows.map((row) => row.book_id));
  const needle = search.trim().toLocaleLowerCase("es");
  const visible = rows
    .filter((row) => filter === "all" || row.status === "pending")
    .filter((row) => {
      if (!needle) return true;
      return (
        String(row.id).includes(needle) ||
        String(row.user_id).includes(needle) ||
        String(row.book_id).includes(needle) ||
        row.status.includes(needle) ||
        (titles.get(row.book_id) ?? "").toLocaleLowerCase("es").includes(needle)
      );
    })
    .sort((a, b) => {
      if (a.status === "pending" && b.status !== "pending") return -1;
      if (b.status === "pending" && a.status !== "pending") return 1;
      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["circulation"] });
    void queryClient.invalidateQueries({ queryKey: ["copies"] });
  };

  const rejectMutation = useMutation({
    mutationFn: (input: { id: number; reason: string }) =>
      endpoints.circulation.reject(input.id, { reason: input.reason }),
    onMutate: () => setActionError(null),
    onSuccess: () => {
      setMessage(es.staff.rejectSuccess);
      setRejectRow(null);
      invalidate();
    },
    onError: (error) => setActionError(error),
  });

  return (
    <div>
      <PageHeader
        title={es.staff.requestsTitle}
        description={es.staff.requestsIntro}
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

      <div className="mb-4 flex flex-wrap items-end gap-3 border border-[rgba(243,240,250,0.14)] bg-[rgba(21,21,30,0.6)] p-3">
        <Field label={es.circulation.statusFilter} htmlFor="request-filter" className="min-w-40">
          <Select
            id="request-filter"
            value={filter}
            onChange={(event) =>
              setFilter(event.target.value as "pending" | "all")
            }
          >
            <option value="pending">{es.staff.filterPending}</option>
            <option value="all">{es.staff.filterAll}</option>
          </Select>
        </Field>
        <Field label={es.staff.queueSearch} htmlFor="request-search" className="min-w-52 flex-1">
          <input
            id="request-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={es.staff.queueSearchPlaceholder}
            className="w-full rounded-xs border border-[rgba(243,240,250,0.28)] bg-[#101018] px-3 py-2 text-ink placeholder:text-[rgba(243,240,250,0.44)] focus:border-oxblood focus:bg-[#1c1c28]"
          />
        </Field>
        <p className="m-0 pb-2 text-[0.75rem] text-[rgba(243,240,250,0.55)]">
          {es.staff.queueNote}
        </p>
      </div>

      {query.isPending ? (
        <PageLoader label={es.common.loading} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={rows.length ? es.staff.noRows : es.staff.noPending}
          body={rows.length ? es.staff.noRowsHint : undefined}
        />
      ) : (
        <>
          <div className="divide-y divide-[rgba(243,240,250,0.12)] border border-[rgba(243,240,250,0.14)]">
            {visible.map((row) => (
              <article key={row.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="m-0 text-[0.72rem] font-semibold text-[rgba(243,240,250,0.52)]">
                      {es.circulation.requestId.replace("{{id}}", String(row.id))}
                    </p>
                    <h2 className="mt-0.5 font-display text-xl font-semibold">
                      <BookLabel bookId={row.book_id} />
                    </h2>
                    <p className="m-0 text-[0.8rem] text-[rgba(243,240,250,0.62)]">
                      {es.circulation.unknownReader.replace(
                        "{{id}}",
                        String(row.user_id),
                      )}{" "}
                      · {formatDateTime(row.created_at)}
                    </p>
                  </div>
                  <StatusBadge
                    tone={
                      row.status === "pending"
                        ? "warn"
                        : row.status === "approved"
                          ? "good"
                          : row.status === "rejected"
                            ? "bad"
                            : "quiet"
                    }
                  >
                    {es.circulation.requestStatus[row.status]}
                  </StatusBadge>
                </div>
                {row.decision_note ? (
                  <p className="mt-1 text-[0.8rem] text-[rgba(243,240,250,0.66)]">
                    {es.circulation.decisionNote}: {row.decision_note}
                  </p>
                ) : null}
                {row.status === "pending" ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => setDeliverRow(row)}>
                      {es.staff.deliver}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => setRejectRow(row)}
                    >
                      {es.staff.reject}
                    </Button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
          {query.hasNextPage ? (
            <>
              <LoadMore
                onClick={() => void query.fetchNextPage()}
                loading={query.isFetchingNextPage}
                label={es.staff.queueLoadMore}
              />
              <p className="mt-2 text-center text-[0.75rem] text-[rgba(243,240,250,0.52)]">
                {es.staff.queueMorePages}
              </p>
            </>
          ) : null}
        </>
      )}

      <DeliverDialog
        key={deliverRow?.id ?? "closed"}
        row={deliverRow}
        onClose={() => setDeliverRow(null)}
        onSuccess={(text) => {
          setMessage(text);
          setDeliverRow(null);
          invalidate();
        }}
      />
      <Modal
        open={Boolean(rejectRow)}
        onOpenChange={(open) => {
          if (!open) setRejectRow(null);
        }}
        title={
          rejectRow
            ? es.staff.rejectTitle.replace("{{id}}", String(rejectRow.id))
            : es.staff.reject
        }
        description={es.staff.rejectIntro}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejectRow(null)}>
              {es.common.cancel}
            </Button>
            <Button
              variant="danger"
              loading={rejectMutation.isPending}
              onClick={() => {
                const form = document.getElementById(
                  "reject-form",
                ) as HTMLFormElement | null;
                form?.requestSubmit();
              }}
            >
              {es.staff.reject}
            </Button>
          </>
        }
      >
        <form
          id="reject-form"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const reason = String(data.get("reason") ?? "").trim();
            if (rejectRow && reason) {
              rejectMutation.mutate({ id: rejectRow.id, reason });
            }
          }}
        >
          <Field
            label={es.staff.rejectReasonLabel}
            htmlFor="reject-reason"
            required
            error={
              rejectMutation.isError
                ? mapApiError(rejectMutation.error).message
                : null
            }
          >
            <Textarea
              id="reject-reason"
              name="reason"
              required
              placeholder={es.staff.rejectReasonPlaceholder}
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}

function DeliverDialog({
  row,
  onClose,
  onSuccess,
}: {
  row: LoanRequestListRow | null;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [copyId, setCopyId] = useState("");
  const copiesQuery = useQuery({
    queryKey: ["copies", row?.book_id ?? 0, "deliver"],
    queryFn: () => endpoints.copies.list(row?.book_id ?? 0, { limit: 100 }),
    enabled: Boolean(row),
    retry: 0,
  });

  const eligible = (copiesQuery.data?.copies ?? []).filter(
    (copy) => copy.available_for_circulation,
  );

  const effectiveCopyId =
    eligible.find((copy) => String(copy.id) === copyId)?.id ?? eligible[0]?.id ?? 0;

  const mutation = useMutation({
    mutationFn: () =>
      endpoints.circulation.deliver(row?.id ?? 0, { copy_id: effectiveCopyId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["circulation"] });
      void queryClient.invalidateQueries({ queryKey: ["copies"] });
      onSuccess(es.staff.deliverSuccess);
    },
  });

  const error = mutation.isError ? mapApiError(mutation.error) : null;

  return (
    <Modal
      open={Boolean(row)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={
        row
          ? es.staff.deliverTitle.replace("{{id}}", String(row.id))
          : es.staff.deliver
      }
      description={es.staff.deliverIntro}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {es.common.cancel}
          </Button>
          <Button
            loading={mutation.isPending}
            disabled={!effectiveCopyId || eligible.length === 0}
            onClick={() => mutation.mutate()}
          >
            {es.staff.deliver}
          </Button>
        </>
      }
    >
      {row ? (
        <div className="space-y-4">
          <p className="m-0 text-[0.9rem] text-[rgba(243,240,250,0.72)]">
            <BookLabel bookId={row.book_id} />
          </p>
          {copiesQuery.isPending ? (
            <PageLoader label={es.common.loading} />
          ) : copiesQuery.isError ? (
            <ErrorState error={copiesQuery.error} compact />
          ) : eligible.length === 0 ? (
            <p className="m-0 text-[0.86rem] text-[rgba(243,240,250,0.66)]">
              {es.staff.deliverNoCopies}
            </p>
          ) : (
            <Field label={es.staff.deliverSelectCopy} htmlFor="deliver-copy" required>
              <Select
                id="deliver-copy"
                value={String(effectiveCopyId)}
                onChange={(event) => setCopyId(event.target.value)}
              >
                {eligible.map((copy) => (
                  <option key={copy.id} value={copy.id}>
                    {copy.inventory_code}
                    {copy.location ? ` · ${copy.location}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {error ? <ErrorState error={mutation.error} compact /> : null}
        </div>
      ) : null}
    </Modal>
  );
}
