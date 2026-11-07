import { useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { endpoints } from "@/api/endpoints";
import { LibrarySpines } from "@/components/LibrarySpines";
import type {
  LoanListRow,
  LoanRequestListRow,
  RenewalListRow,
  ReservationListRow,
} from "@/api/types";
import { useAuth } from "@/auth/AuthProvider";
import { canStaff } from "@/auth/capabilities";
import { LoadMore } from "@/components/LoadMore";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { BookLabel, CopyLabel, PageLoader } from "@/components/ui/Loading";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { es } from "@/i18n/es";
import { formatDate, formatDateTime, isOverdueDueAt } from "@/lib/dates";
import "./account-library.css";

const PAGE_SIZE = 20;
type Tab = "loans" | "requests" | "renewals" | "reservations";

const tabs: { key: Tab; label: string }[] = [
  { key: "loans", label: es.circulation.tabs.loans },
  { key: "requests", label: es.circulation.tabs.requests },
  { key: "renewals", label: es.circulation.tabs.renewals },
  { key: "reservations", label: es.circulation.tabs.reservations },
];

export function MyCirculationPage() {
  useDocumentTitle(es.routeTitles.myCirculation);
  const { user } = useAuth();
  const staff = canStaff(user);
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("loans");
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  const loansQuery = useInfiniteQuery({
    queryKey: ["circulation", "loans", "mine"],
    queryFn: ({ pageParam }) =>
      endpoints.circulation.listLoans({ limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.data.length === PAGE_SIZE
        ? allPages.length * PAGE_SIZE
        : undefined,
  });
  const requestsQuery = useInfiniteQuery({
    queryKey: ["circulation", "requests", "mine"],
    queryFn: ({ pageParam }) =>
      endpoints.circulation.listRequests({ limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.data.length === PAGE_SIZE
        ? allPages.length * PAGE_SIZE
        : undefined,
  });
  const renewalsQuery = useInfiniteQuery({
    queryKey: ["circulation", "renewals", "mine"],
    queryFn: ({ pageParam }) =>
      endpoints.circulation.listRenewals({ limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.data.length === PAGE_SIZE
        ? allPages.length * PAGE_SIZE
        : undefined,
  });
  const reservationsQuery = useInfiniteQuery({
    queryKey: ["circulation", "reservations", "mine"],
    queryFn: ({ pageParam }) =>
      endpoints.circulation.listReservations({
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.data.length === PAGE_SIZE
        ? allPages.length * PAGE_SIZE
        : undefined,
  });

  const myId = user?.id ?? 0;
  const allLoans = useMemo(
    () => (loansQuery.data?.pages ?? []).flatMap((page) => page.data),
    [loansQuery.data],
  );
  const loans = allLoans.filter((loan) => loan.user_id === myId);
  const requests = (requestsQuery.data?.pages ?? [])
    .flatMap((page) => page.data)
    .filter((request) => request.user_id === myId);
  const reservations = (reservationsQuery.data?.pages ?? [])
    .flatMap((page) => page.data)
    .filter((reservation) => reservation.user_id === myId);
  const loanMap = useMemo(
    () => new Map(allLoans.map((loan) => [loan.id, loan])),
    [allLoans],
  );
  const renewals = (renewalsQuery.data?.pages ?? [])
    .flatMap((page) => page.data)
    .filter(
      (renewal) =>
        !staff || loanMap.get(renewal.loan_id)?.user_id === myId,
    );

  const activeLoans = loans.filter((loan) => !loan.returned_at);
  const hasOverdue = activeLoans.some((loan) =>
    isOverdueDueAt(loan.due_at, loan.returned_at),
  );
  const hasTwoLoans = activeLoans.length >= 2;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["circulation"] });
    void queryClient.invalidateQueries({ queryKey: ["recommendations"] });
  };

  const cancelMutation = useMutation({
    mutationFn: async (input: {
      kind: "request" | "renewal" | "reservation";
      id: number;
    }) => {
      if (input.kind === "request")
        return endpoints.circulation.cancelRequest(input.id);
      if (input.kind === "renewal")
        return endpoints.circulation.cancelRenewal(input.id);
      return endpoints.circulation.cancelReservation(input.id);
    },
    onMutate: () => {
      setActionError(null);
      setMessage(null);
    },
    onSuccess: () => {
      setMessage(es.circulation.cancelSuccess);
      invalidate();
    },
    onError: (error) => setActionError(error),
  });

  const renewalMutation = useMutation({
    mutationFn: (loanId: number) =>
      endpoints.circulation.requestRenewal(loanId),
    onMutate: () => {
      setActionError(null);
      setMessage(null);
    },
    onSuccess: () => {
      setMessage(es.circulation.renewSuccess);
      invalidate();
    },
    onError: (error) => setActionError(error),
  });

  const cancelButton = (
    kind: "request" | "renewal" | "reservation",
    id: number,
    title: string,
  ) => (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="sm">
          {kind === "request"
            ? es.circulation.cancelRequest
            : kind === "renewal"
              ? es.circulation.cancelRenewal
              : es.circulation.cancelReservation}
        </Button>
      }
      title={title}
      destructive
      onConfirm={() => cancelMutation.mutateAsync({ kind, id })}
      loading={cancelMutation.isPending}
    />
  );

  function renderLoans(rows: LoanListRow[]) {
    if (!rows.length)
      return (
        <EmptyState
          title={es.circulation.noLoans}
          body={es.circulation.loansHint}
          className="library-empty"
          action={
            <Button asChild variant="secondary">
              <Link to="/catalog">{es.home.shortcutCatalog}</Link>
            </Button>
          }
        />
      );
    return (
      <div className="circulation-records divide-y divide-[rgba(243,240,250,0.12)]">
        {rows.map((loan) => {
          const overdue = isOverdueDueAt(loan.due_at, loan.returned_at);
          const loanRenewals = (renewalsQuery.data?.pages ?? [])
            .flatMap((page) => page.data)
            .filter((renewal) => renewal.loan_id === loan.id);
          const pendingRenewal = loanRenewals.some(
            (renewal) => renewal.status === "pending",
          );
          const approvedRenewal = loanRenewals.some(
            (renewal) => renewal.status === "approved",
          );
          const blockReason = loan.returned_at
            ? es.circulation.renewalDisabledReturned
            : overdue
              ? es.circulation.renewalDisabledOverdue
              : pendingRenewal
                ? es.circulation.renewalDisabledPending
                : approvedRenewal
                  ? es.circulation.renewalDisabledApproved
                  : null;
          return (
            <article key={loan.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="m-0 text-[0.72rem] font-semibold text-[rgba(243,240,250,0.52)]">
                    {es.circulation.loanReference.replace("{{id}}", String(loan.id))}
                  </p>
                  <h2 className="mt-0.5 font-display text-xl font-semibold text-ink">
                    <BookLabel bookId={loan.book_id} />
                  </h2>
                  <p className="m-0 text-[0.8rem] text-[rgba(243,240,250,0.62)]">
                    {es.circulation.loanCopy}: <CopyLabel bookId={loan.book_id} copyId={loan.copy_id} />
                  </p>
                </div>
                <StatusBadge tone={overdue ? "bad" : loan.returned_at ? "quiet" : "good"}>
                  {loan.returned_at
                    ? es.circulation.loanStatus.returned
                    : overdue
                      ? es.circulation.loanStatus.overdue
                      : es.circulation.loanStatus.active}
                </StatusBadge>
              </div>
              <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[0.8rem]">
                <div>
                  <dt className="inline text-[rgba(243,240,250,0.52)]">
                    {es.circulation.deliveredAt}:{" "}
                  </dt>
                  <dd className="m-0 inline font-tabular">
                    {formatDate(loan.delivered_at)}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-[rgba(243,240,250,0.52)]">
                    {es.circulation.dueAt}:{" "}
                  </dt>
                  <dd className="m-0 inline font-tabular">
                    {formatDate(loan.due_at)}
                  </dd>
                </div>
                {loan.returned_at ? (
                  <div>
                    <dt className="inline text-[rgba(243,240,250,0.52)]">
                      {es.circulation.returnedAt}:{" "}
                    </dt>
                    <dd className="m-0 inline font-tabular">
                      {formatDate(loan.returned_at)}
                    </dd>
                  </div>
                ) : null}
              </dl>
              {!loan.returned_at ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={Boolean(blockReason)}
                    title={blockReason ?? undefined}
                    loading={
                      renewalMutation.isPending &&
                      renewalMutation.variables === loan.id
                    }
                    onClick={() => renewalMutation.mutate(loan.id)}
                  >
                    {es.circulation.requestRenewal}
                  </Button>
                  {blockReason ? (
                    <span className="text-[0.78rem] text-[rgba(243,240,250,0.58)]">
                      {blockReason}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    );
  }

  function renderRequests(rows: LoanRequestListRow[]) {
    if (!rows.length)
      return (
        <EmptyState title={es.circulation.noRequests} body={es.circulation.requestsHint} className="library-empty" />
      );
    return (
      <div className="circulation-records divide-y divide-[rgba(243,240,250,0.12)]">
        {rows.map((request) => (
          <article key={request.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="m-0 text-[0.72rem] font-semibold text-[rgba(243,240,250,0.52)]">
                  {es.circulation.requestId.replace("{{id}}", String(request.id))}
                </p>
                <h2 className="mt-0.5 font-display text-xl font-semibold">
                  <BookLabel bookId={request.book_id} />
                </h2>
              </div>
              <StatusBadge
                tone={
                  request.status === "pending"
                    ? "warn"
                    : request.status === "approved"
                      ? "good"
                      : request.status === "rejected"
                        ? "bad"
                        : "quiet"
                }
              >
                {es.circulation.requestStatus[request.status]}
              </StatusBadge>
            </div>
            <p className="mt-2 text-[0.8rem] text-[rgba(243,240,250,0.6)]">
              {es.circulation.requestedOn}: {formatDateTime(request.created_at)}
            </p>
            {request.decision_note ? (
              <p className="mt-1 text-[0.82rem] text-[rgba(243,240,250,0.68)]">
                {es.circulation.decisionNote}: {request.decision_note}
              </p>
            ) : null}
            {request.status === "pending" ? (
              <div className="mt-3">
                {cancelButton(
                  "request",
                  request.id,
                  es.circulation.requestCancelConfirm,
                )}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    );
  }

  function renderRenewals(rows: RenewalListRow[]) {
    if (!rows.length)
      return (
        <EmptyState title={es.circulation.noRenewals} body={es.circulation.renewalsHint} className="library-empty" />
      );
    return (
      <div className="circulation-records divide-y divide-[rgba(243,240,250,0.12)]">
        {rows.map((renewal) => {
          const loan = loanMap.get(renewal.loan_id);
          return (
            <article key={renewal.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="m-0 text-[0.72rem] font-semibold text-[rgba(243,240,250,0.52)]">
                    {es.circulation.renewalId.replace("{{id}}", String(renewal.id))}
                  </p>
                  <h2 className="mt-0.5 font-display text-xl font-semibold">
                    {loan ? (
                      <BookLabel bookId={loan.book_id} />
                    ) : (
                      es.circulation.loanReference.replace(
                        "{{id}}",
                        String(renewal.loan_id),
                      )
                    )}
                  </h2>
                </div>
                <StatusBadge
                  tone={
                    renewal.status === "pending"
                      ? "warn"
                      : renewal.status === "approved"
                        ? "good"
                        : renewal.status === "rejected"
                          ? "bad"
                          : "quiet"
                  }
                >
                  {es.circulation.renewalStatus[renewal.status]}
                </StatusBadge>
              </div>
              <dl className="mt-3 grid gap-x-6 gap-y-1 text-[0.8rem] sm:grid-cols-2">
                <div>
                  <dt className="inline text-[rgba(243,240,250,0.52)]">
                    {es.circulation.requestedAt}:{" "}
                  </dt>
                  <dd className="m-0 inline font-tabular">
                    {formatDateTime(renewal.requested_at)}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-[rgba(243,240,250,0.52)]">
                    {es.circulation.previousDueAt}:{" "}
                  </dt>
                  <dd className="m-0 inline font-tabular">
                    {formatDate(renewal.previous_due_at)}
                  </dd>
                </div>
                {renewal.new_due_at ? (
                  <div>
                    <dt className="inline text-[rgba(243,240,250,0.52)]">
                      {es.circulation.newDueAt}:{" "}
                    </dt>
                    <dd className="m-0 inline font-tabular">
                      {formatDate(renewal.new_due_at)}
                    </dd>
                  </div>
                ) : null}
              </dl>
              {renewal.decision_note ? (
                <p className="mt-1 text-[0.82rem] text-[rgba(243,240,250,0.68)]">
                  {es.circulation.decisionNote}: {renewal.decision_note}
                </p>
              ) : null}
              {renewal.status === "pending" ? (
                <div className="mt-3">
                  {cancelButton(
                    "renewal",
                    renewal.id,
                    es.circulation.renewalCancelConfirm,
                  )}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    );
  }

  function renderReservations(rows: ReservationListRow[]) {
    if (!rows.length)
      return (
        <EmptyState
          title={es.circulation.noReservations}
          body={es.circulation.reservationsHint}
          className="library-empty"
        />
      );
    return (
      <div className="circulation-records divide-y divide-[rgba(243,240,250,0.12)]">
        {rows.map((reservation) => {
          const ready = reservation.status === "ready";
          return (
            <article key={reservation.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="m-0 text-[0.72rem] font-semibold text-[rgba(243,240,250,0.52)]">
                    {es.circulation.reservationId.replace(
                      "{{id}}",
                      String(reservation.id),
                    )}
                  </p>
                  <h2 className="mt-0.5 font-display text-xl font-semibold">
                    <BookLabel bookId={reservation.book_id} />
                  </h2>
                </div>
                <StatusBadge
                  tone={
                    ready
                      ? "good"
                      : reservation.status === "waiting"
                        ? "warn"
                        : "quiet"
                  }
                >
                  {es.circulation.reservationStatus[reservation.status]}
                </StatusBadge>
              </div>
              <p className="mt-2 text-[0.8rem] text-[rgba(243,240,250,0.6)]">
                {es.circulation.requestedOn}: {formatDateTime(reservation.created_at)}
              </p>
              {ready && reservation.pickup_expires_at ? (
                <p className="mt-1 text-[0.82rem] text-[#67501d]">
                  {es.circulation.pickupUntil}:{" "}
                  <span className="font-tabular">
                    {formatDateTime(reservation.pickup_expires_at)}
                  </span>
                </p>
              ) : null}
              {ready ? (
                <p className="mt-1 text-[0.8rem] text-[rgba(243,240,250,0.6)]">
                  {es.circulation.pickupAtCounter}
                </p>
              ) : null}
              {reservation.status === "waiting" || ready ? (
                <div className="mt-3">
                  {cancelButton(
                    "reservation",
                    reservation.id,
                    es.circulation.reservationCancelConfirm,
                  )}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    );
  }

  const activeQuery =
    tab === "loans"
      ? loansQuery
      : tab === "requests"
        ? requestsQuery
        : tab === "renewals"
          ? renewalsQuery
          : reservationsQuery;

  return (
    <div className="circulation-page">
      <PageHeader title={es.circulation.title} description={es.circulation.intro} />
      <LibrarySpines />

      {hasOverdue ? (
        <div className="mb-4 border-l-2 border-oxblood bg-[rgba(107,32,36,0.06)] px-4 py-3 text-[0.86rem] text-oxblood">
          {es.circulation.overdueNotice}
        </div>
      ) : hasTwoLoans ? (
        <div className="mb-4 border-l-2 border-brass bg-[rgba(168,134,59,0.1)] px-4 py-3 text-[0.86rem] text-[#5c4818]">
          {es.circulation.twoLoansNotice}
        </div>
      ) : null}

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

      <div
        role="tablist"
        aria-label={es.circulation.title}
        className="circulation-tabs mb-5"
      >
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            onClick={() => setTab(item.key)}
            className="font-semibold text-[0.86rem]"
          >
            {item.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {activeQuery.isPending ? (
          <PageLoader label={es.common.loading} />
        ) : activeQuery.isError ? (
          <ErrorState
            error={activeQuery.error}
            onRetry={() => void activeQuery.refetch()}
          />
        ) : (
          <>
            {tab === "loans"
              ? renderLoans(loans)
              : tab === "requests"
                ? renderRequests(requests)
                : tab === "renewals"
                  ? renderRenewals(renewals)
                  : renderReservations(reservations)}
            {activeQuery.hasNextPage ? (
              <LoadMore
                onClick={() => void activeQuery.fetchNextPage()}
                loading={activeQuery.isFetchingNextPage}
                label={es.common.loadMore}
                note={es.common.morePages}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
