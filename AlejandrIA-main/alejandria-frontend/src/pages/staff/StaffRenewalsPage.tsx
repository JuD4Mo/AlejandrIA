import { useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { endpoints } from "@/api/endpoints";
import type { RenewalListRow } from "@/api/types";
import { LoadMore } from "@/components/LoadMore";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
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
import { formatDate, formatDateTime } from "@/lib/dates";
import { mapApiError } from "@/lib/errors";

const PAGE_SIZE = 20;

export function StaffRenewalsPage() {
  useDocumentTitle(es.routeTitles.staffRenewals);
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [rejectRow, setRejectRow] = useState<RenewalListRow | null>(null);

  const query = useInfiniteQuery({
    queryKey: ["circulation", "renewals", "staff"],
    queryFn: ({ pageParam }) =>
      endpoints.circulation.listRenewals({ limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.data.length === PAGE_SIZE ? allPages.length * PAGE_SIZE : undefined,
    retry: 0,
  });
  const loansQuery = useQuery({
    queryKey: ["circulation", "loans", "staff-map"],
    queryFn: () => endpoints.circulation.listLoans({ limit: 100 }),
    retry: 0,
  });

  const rows = useMemo(
    () => (query.data?.pages ?? []).flatMap((page) => page.data),
    [query.data],
  );
  const loanMap = useMemo(
    () =>
      new Map((loansQuery.data?.data ?? []).map((loan) => [loan.id, loan])),
    [loansQuery.data],
  );
  const titles = useBookTitles(
    rows
      .map((row) => loanMap.get(row.loan_id)?.book_id)
      .filter((id): id is number => Boolean(id)),
  );
  const needle = search.trim().toLocaleLowerCase("es");

  const visible = rows
    .filter((row) => filter === "all" || row.status === "pending")
    .filter((row) => {
      if (!needle) return true;
      const loan = loanMap.get(row.loan_id);
      return (
        String(row.id).includes(needle) ||
        String(row.loan_id).includes(needle) ||
        (loan ? String(loan.user_id).includes(needle) : false) ||
        (loan
          ? (titles.get(loan.book_id) ?? "")
              .toLocaleLowerCase("es")
              .includes(needle)
          : false) ||
        row.status.includes(needle)
      );
    })
    .sort((a, b) => {
      if (a.status === "pending" && b.status !== "pending") return -1;
      if (b.status === "pending" && a.status !== "pending") return 1;
      return new Date(b.requested_at).getTime() - new Date(a.requested_at).getTime();
    });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["circulation"] });
  };

  const decisionMutation = useMutation({
    mutationFn: (input: {
      id: number;
      approve: boolean;
      reason?: string;
    }) =>
      endpoints.circulation.decideRenewal(input.id, {
        approve: input.approve,
        reason: input.reason,
      }),
    onMutate: () => setActionError(null),
    onSuccess: (_data, variables) => {
      setMessage(
        variables.approve ? es.staff.approveSuccess : es.staff.rejectRenewalSuccess,
      );
      setRejectRow(null);
      invalidate();
    },
    onError: (error) => setActionError(error),
  });

  return (
    <div>
      <PageHeader
        title={es.staff.renewalsTitle}
        description={es.staff.renewalsIntro}
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
        <Field label={es.circulation.statusFilter} htmlFor="renewal-filter" className="min-w-40">
          <Select
            id="renewal-filter"
            value={filter}
            onChange={(event) =>
              setFilter(event.target.value as "pending" | "all")
            }
          >
            <option value="pending">{es.staff.filterPending}</option>
            <option value="all">{es.staff.filterAll}</option>
          </Select>
        </Field>
        <Field label={es.staff.queueSearch} htmlFor="renewal-search" className="min-w-52 flex-1">
          <input
            id="renewal-search"
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
          title={rows.length ? es.staff.noRows : es.circulation.noRenewals}
          body={rows.length ? es.staff.noRowsHint : es.circulation.renewalsHint}
        />
      ) : (
        <>
          <div className="divide-y divide-[rgba(243,240,250,0.12)] border border-[rgba(243,240,250,0.14)]">
            {visible.map((row) => {
              const loan = loanMap.get(row.loan_id);
              return (
                <article key={row.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="m-0 text-[0.72rem] font-semibold text-[rgba(243,240,250,0.52)]">
                        {es.circulation.renewalId.replace("{{id}}", String(row.id))}
                        {" · "}
                        {es.circulation.loanReference.replace(
                          "{{id}}",
                          String(row.loan_id),
                        )}
                      </p>
                      <h2 className="mt-0.5 font-display text-xl font-semibold">
                        {loan ? (
                          <BookLabel bookId={loan.book_id} />
                        ) : (
                          es.circulation.loanReference.replace(
                            "{{id}}",
                            String(row.loan_id),
                          )
                        )}
                      </h2>
                      {loan ? (
                        <p className="m-0 text-[0.8rem] text-[rgba(243,240,250,0.62)]">
                          {es.circulation.unknownReader.replace(
                            "{{id}}",
                            String(loan.user_id),
                          )}
                        </p>
                      ) : null}
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
                      {es.circulation.renewalStatus[row.status]}
                    </StatusBadge>
                  </div>
                  <dl className="mt-2 grid gap-x-6 gap-y-1 text-[0.8rem] sm:grid-cols-2">
                    <div>
                      <dt className="inline text-[rgba(243,240,250,0.52)]">
                        {es.circulation.requestedAt}:{" "}
                      </dt>
                      <dd className="m-0 inline font-tabular">
                        {formatDateTime(row.requested_at)}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline text-[rgba(243,240,250,0.52)]">
                        {es.circulation.previousDueAt}:{" "}
                      </dt>
                      <dd className="m-0 inline font-tabular">
                        {formatDate(row.previous_due_at)}
                      </dd>
                    </div>
                    {row.new_due_at ? (
                      <div>
                        <dt className="inline text-[rgba(243,240,250,0.52)]">
                          {es.circulation.newDueAt}:{" "}
                        </dt>
                        <dd className="m-0 inline font-tabular">
                          {formatDate(row.new_due_at)}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                  {row.decision_note ? (
                    <p className="mt-1 text-[0.82rem] text-[rgba(243,240,250,0.68)]">
                      {es.circulation.decisionNote}: {row.decision_note}
                    </p>
                  ) : null}
                  {row.status === "pending" ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <ConfirmDialog
                        trigger={
                          <Button size="sm">{es.staff.approve}</Button>
                        }
                        title={es.staff.approveRenewalTitle.replace(
                          "{{id}}",
                          String(row.id),
                        )}
                        body={es.staff.approveRenewalIntro}
                        confirmLabel={es.staff.approve}
                        onConfirm={() =>
                          decisionMutation.mutateAsync({
                            id: row.id,
                            approve: true,
                          })
                        }
                        loading={
                          decisionMutation.isPending &&
                          decisionMutation.variables?.id === row.id &&
                          decisionMutation.variables.approve
                        }
                      />
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
              );
            })}
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

      <Modal
        open={Boolean(rejectRow)}
        onOpenChange={(open) => {
          if (!open) setRejectRow(null);
        }}
        title={
          rejectRow
            ? es.staff.rejectRenewalTitle.replace("{{id}}", String(rejectRow.id))
            : es.staff.reject
        }
        description={es.staff.rejectRenewalIntro}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejectRow(null)}>
              {es.common.cancel}
            </Button>
            <Button
              variant="danger"
              loading={decisionMutation.isPending}
              onClick={() => {
                const form = document.getElementById(
                  "renewal-reject-form",
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
          id="renewal-reject-form"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const reason = String(data.get("reason") ?? "").trim();
            if (rejectRow && reason) {
              decisionMutation.mutate({
                id: rejectRow.id,
                approve: false,
                reason,
              });
            }
          }}
        >
          <Field
            label={es.staff.rejectReasonLabel}
            htmlFor="renewal-reject-reason"
            required
            error={
              decisionMutation.isError
                ? mapApiError(decisionMutation.error).message
                : null
            }
          >
            <Textarea
              id="renewal-reject-reason"
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
