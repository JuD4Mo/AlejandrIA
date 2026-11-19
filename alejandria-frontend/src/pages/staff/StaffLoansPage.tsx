import { useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { endpoints } from "@/api/endpoints";
import type { LoanListRow } from "@/api/types";
import { LoadMore } from "@/components/LoadMore";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Field, Select, inputClass } from "@/components/ui/Field";
import { BookLabel, CopyLabel, PageLoader, ReaderLabel } from "@/components/ui/Loading";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useBookTitles } from "@/hooks/useNamedLabels";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { es } from "@/i18n/es";
import { formatDate, isOverdueDueAt } from "@/lib/dates";

const PAGE_SIZE = 20;
type Filter = "active" | "overdue" | "returned" | "all";

export function StaffLoansPage() {
  useDocumentTitle(es.routeTitles.staffLoans);
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("active");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  const query = useInfiniteQuery({
    queryKey: ["circulation", "loans", "staff"],
    queryFn: ({ pageParam }) =>
      endpoints.circulation.listLoans({ limit: PAGE_SIZE, offset: pageParam }),
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
    .filter((loan) => {
      const overdue = isOverdueDueAt(loan.due_at, loan.returned_at);
      if (filter === "active") return !loan.returned_at;
      if (filter === "overdue") return overdue;
      if (filter === "returned") return Boolean(loan.returned_at);
      return true;
    })
    .filter((loan) => {
      if (!needle) return true;
      return (
        String(loan.id).includes(needle) ||
        String(loan.user_id).includes(needle) ||
        String(loan.book_id).includes(needle) ||
        (titles.get(loan.book_id) ?? "").toLocaleLowerCase("es").includes(needle)
      );
    })
    .sort((a, b) => {
      const aOverdue = isOverdueDueAt(a.due_at, a.returned_at);
      const bOverdue = isOverdueDueAt(b.due_at, b.returned_at);
      if (aOverdue && !bOverdue) return -1;
      if (bOverdue && !aOverdue) return 1;
      return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
    });

  const returnMutation = useMutation({
    mutationFn: (id: number) => endpoints.circulation.returnLoan(id),
    onMutate: () => {
      setActionError(null);
      setMessage(null);
    },
    onSuccess: () => {
      setMessage(es.staff.returnSuccess);
      void queryClient.invalidateQueries({ queryKey: ["circulation"] });
      void queryClient.invalidateQueries({ queryKey: ["copies"] });
    },
    onError: (error) => setActionError(error),
  });

  return (
    <div>
      <PageHeader title={es.staff.loansTitle} description={es.staff.loansIntro} />

      {message ? (
        <p
          role="status"
          className="notice notice--success mb-4"
        >
          {message}
        </p>
      ) : null}
      {actionError ? (
        <div className="mb-4">
          <ErrorState error={actionError} compact />
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-end gap-3 toolbar-panel p-3">
        <Field label={es.circulation.statusFilter} htmlFor="loan-filter" className="min-w-40">
          <Select
            id="loan-filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value as Filter)}
          >
            <option value="active">{es.staff.filterActive}</option>
            <option value="overdue">{es.staff.filterOverdue}</option>
            <option value="returned">{es.staff.filterReturned}</option>
            <option value="all">{es.staff.filterAll}</option>
          </Select>
        </Field>
        <Field label={es.staff.queueSearch} htmlFor="loan-search" className="min-w-52 flex-1">
          <input
            id="loan-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={es.staff.queueSearchPlaceholder}
            className={inputClass}
          />
        </Field>
        <p className="m-0 pb-2 text-[0.75rem] text-fg-subtle">
          {es.staff.queueNote}
        </p>
      </div>

      {query.isPending ? (
        <PageLoader label={es.common.loading} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={rows.length ? es.staff.noRows : es.circulation.noLoans}
          body={rows.length ? es.staff.noRowsHint : es.circulation.loansHint}
        />
      ) : (
        <>
          <div className="divide-y divide-line border border-line">
            {visible.map((loan) => (
              <LoanRow
                key={loan.id}
                loan={loan}
                loading={
                  returnMutation.isPending && returnMutation.variables === loan.id
                }
                onReturn={() => returnMutation.mutateAsync(loan.id)}
              />
            ))}
          </div>
          {query.hasNextPage ? (
            <>
              <LoadMore
                onClick={() => void query.fetchNextPage()}
                loading={query.isFetchingNextPage}
                label={es.staff.queueLoadMore}
              />
              <p className="mt-2 text-center text-[0.75rem] text-fg-subtle">
                {es.staff.queueMorePages}
              </p>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

function LoanRow({
  loan,
  loading,
  onReturn,
}: {
  loan: LoanListRow;
  loading: boolean;
  onReturn: () => Promise<unknown>;
}) {
  const overdue = isOverdueDueAt(loan.due_at, loan.returned_at);
  return (
    <article className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-[0.72rem] font-semibold text-fg-subtle">
            {es.circulation.loanReference.replace("{{id}}", String(loan.id))}
          </p>
          <h2 className="mt-0.5 font-display text-xl font-semibold">
            <BookLabel bookId={loan.book_id} />
          </h2>
          <p className="m-0 text-[0.8rem] text-fg-subtle">
            <ReaderLabel userId={loan.user_id} />
            {" · "}
            <CopyLabel bookId={loan.book_id} copyId={loan.copy_id} />
          </p>
        </div>
        <StatusBadge
          tone={overdue ? "bad" : loan.returned_at ? "quiet" : "good"}
        >
          {loan.returned_at
            ? es.circulation.loanStatus.returned
            : overdue
              ? es.circulation.loanStatus.overdue
              : es.circulation.loanStatus.active}
        </StatusBadge>
      </div>
      <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[0.8rem]">
        <div>
          <dt className="inline text-fg-subtle">
            {es.circulation.deliveredAt}:{" "}
          </dt>
          <dd className="m-0 inline font-tabular">
            {formatDate(loan.delivered_at)}
          </dd>
        </div>
        <div>
          <dt className="inline text-fg-subtle">
            {es.circulation.dueAt}:{" "}
          </dt>
          <dd className="m-0 inline font-tabular">{formatDate(loan.due_at)}</dd>
        </div>
        {loan.returned_at ? (
          <div>
            <dt className="inline text-fg-subtle">
              {es.circulation.returnedAt}:{" "}
            </dt>
            <dd className="m-0 inline font-tabular">
              {formatDate(loan.returned_at)}
            </dd>
          </div>
        ) : null}
      </dl>
      {!loan.returned_at ? (
        <div className="mt-3">
          <ConfirmDialog
            trigger={
              <Button size="sm" variant="secondary">
                {es.staff.returnLoan}
              </Button>
            }
            title={es.staff.returnTitle.replace("{{id}}", String(loan.id))}
            body={es.staff.returnIntro}
            confirmLabel={es.staff.returnLoan}
            onConfirm={onReturn}
            loading={loading}
          />
        </div>
      ) : null}
    </article>
  );
}
