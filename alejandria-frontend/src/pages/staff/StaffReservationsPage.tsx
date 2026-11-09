import { useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { endpoints } from "@/api/endpoints";
import type { ReservationListRow } from "@/api/types";
import { LoadMore } from "@/components/LoadMore";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Field, Select } from "@/components/ui/Field";
import { BookLabel, PageLoader } from "@/components/ui/Loading";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useBookTitles } from "@/hooks/useNamedLabels";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { es } from "@/i18n/es";
import { formatDateTime, isPast } from "@/lib/dates";

const PAGE_SIZE = 20;
type Filter = "waiting" | "ready" | "closed" | "all";

export function StaffReservationsPage() {
  useDocumentTitle(es.routeTitles.staffReservations);
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("ready");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  const query = useInfiniteQuery({
    queryKey: ["circulation", "reservations", "staff"],
    queryFn: ({ pageParam }) =>
      endpoints.circulation.listReservations({
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
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
    .filter((row) => {
      if (filter === "all") return true;
      if (filter === "closed")
        return ["fulfilled", "expired", "cancelled"].includes(row.status);
      return row.status === filter;
    })
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
      if (a.status === "ready" && b.status !== "ready") return -1;
      if (b.status === "ready" && a.status !== "ready") return 1;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

  const pickupMutation = useMutation({
    mutationFn: (id: number) => endpoints.circulation.pickup(id),
    onMutate: () => {
      setActionError(null);
      setMessage(null);
    },
    onSuccess: () => {
      setMessage(es.staff.pickupSuccess);
      void queryClient.invalidateQueries({ queryKey: ["circulation"] });
      void queryClient.invalidateQueries({ queryKey: ["copies"] });
    },
    onError: (error) => setActionError(error),
  });

  return (
    <div>
      <PageHeader
        title={es.staff.reservationsTitle}
        description={es.staff.reservationsIntro}
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
        <Field label={es.circulation.statusFilter} htmlFor="reservation-filter" className="min-w-40">
          <Select
            id="reservation-filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value as Filter)}
          >
            <option value="ready">{es.staff.filterReady}</option>
            <option value="waiting">{es.staff.filterWaiting}</option>
            <option value="closed">{es.staff.reservationClosed}</option>
            <option value="all">{es.staff.filterAll}</option>
          </Select>
        </Field>
        <Field label={es.staff.queueSearch} htmlFor="reservation-search" className="min-w-52 flex-1">
          <input
            id="reservation-search"
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
          title={rows.length ? es.staff.noRows : es.circulation.noReservations}
          body={
            rows.length ? es.staff.noRowsHint : es.circulation.reservationsHint
          }
        />
      ) : (
        <>
          <div className="divide-y divide-[rgba(243,240,250,0.12)] border border-[rgba(243,240,250,0.14)]">
            {visible.map((row) => (
              <ReservationRow
                key={row.id}
                row={row}
                loading={
                  pickupMutation.isPending && pickupMutation.variables === row.id
                }
                onPickup={() => pickupMutation.mutateAsync(row.id)}
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
              <p className="mt-2 text-center text-[0.75rem] text-[rgba(243,240,250,0.52)]">
                {es.staff.queueMorePages}
              </p>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

function ReservationRow({
  row,
  loading,
  onPickup,
}: {
  row: ReservationListRow;
  loading: boolean;
  onPickup: () => Promise<unknown>;
}) {
  const expired = row.pickup_expires_at ? isPast(row.pickup_expires_at) : true;
  const canPickup = row.status === "ready" && !expired;
  const tone =
    row.status === "ready"
      ? "good"
      : row.status === "waiting"
        ? "warn"
        : row.status === "expired" || row.status === "cancelled"
          ? "quiet"
          : "neutral";
  return (
    <article className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-[0.72rem] font-semibold text-[rgba(243,240,250,0.52)]">
            {es.circulation.reservationId.replace("{{id}}", String(row.id))}
          </p>
          <h2 className="mt-0.5 font-display text-xl font-semibold">
            <BookLabel bookId={row.book_id} />
          </h2>
          <p className="m-0 text-[0.8rem] text-[rgba(243,240,250,0.62)]">
            {es.circulation.unknownReader.replace("{{id}}", String(row.user_id))}
            {row.copy_id
              ? ` · ${es.circulation.unknownCopy.replace("{{id}}", String(row.copy_id))}`
              : ""}
            {" · "}
            {formatDateTime(row.created_at)}
          </p>
        </div>
        <StatusBadge tone={tone}>
          {es.circulation.reservationStatus[row.status]}
        </StatusBadge>
      </div>
      {row.status === "ready" && row.pickup_expires_at ? (
        <p
          className={
            expired
              ? "mt-2 text-[0.82rem] text-oxblood"
              : "mt-2 text-[0.82rem] text-[#67501d]"
          }
        >
          {expired
            ? es.circulation.pickupExpired
            : es.staff.readyWithDeadline.replace(
                "{{date}}",
                formatDateTime(row.pickup_expires_at),
              )}
        </p>
      ) : null}
      {row.assignment_origin ? (
        <p className="mt-1 text-[0.75rem] text-[rgba(243,240,250,0.52)]">
          {row.assignment_origin === "manual"
            ? "Asignación manual"
            : row.assignment_origin === "system"
              ? "Asignación automática"
              : "Origen de asignación desconocido"}
        </p>
      ) : null}
      {row.status === "ready" ? (
        <div className="mt-3">
          <ConfirmDialog
            trigger={
              <Button size="sm" disabled={!canPickup}>
                {es.staff.pickup}
              </Button>
            }
            title={es.staff.pickupTitle.replace("{{id}}", String(row.id))}
            body={es.staff.pickupIntro}
            confirmLabel={es.staff.pickup}
            onConfirm={onPickup}
            loading={loading}
          />
          {!canPickup ? (
            <p className="mt-1 text-[0.78rem] text-[rgba(243,240,250,0.6)]">
              {es.staff.pickupDisabled}
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
