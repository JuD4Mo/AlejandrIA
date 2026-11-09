import { useQuery } from "@tanstack/react-query";
import { useReducedMotion } from "motion/react";
import { useRef } from "react";
import { Link } from "react-router-dom";
import { endpoints } from "@/api/endpoints";
import type { LoanListRow } from "@/api/types";
import { useAuth } from "@/auth/AuthProvider";
import { canRead, canStaff } from "@/auth/capabilities";
import { ForYouRecommendations } from "@/components/recommendations/ForYouRecommendations";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { es } from "@/i18n/es";
import { formatDateTime, isOverdueDueAt } from "@/lib/dates";
import { FlipBook } from "./FlipBook";
import "./home-book.css";

// Decorative cloth colors, same family as the login shelf. Move to a shared token module if you prefer.
const SPINE_COLORS = ["#7A2430", "#3E5C76", "#2F5D50", "#8A5A44", "#5B4B6B", "#29405A"] as const;

const fill = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce(
    (text, [key, value]) => text.replace(`{{${key}}}`, String(value)),
    template,
  );

function isMine(row: { user_id: number }, userId: number): boolean {
  return row.user_id === userId;
}

function Slot({
  n,
  loan,
  loading,
}: {
  n: number;
  loan: LoanListRow | undefined;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="book-slot book-ghost" aria-hidden="true">
        <span className="book-slot-spine" style={{ height: "3.4rem", background: "rgba(27,26,23,0.25)" }} />
      </div>
    );
  }
  if (!loan) {
    return <div className="book-slot book-slot--free book-typed">{es.homeBook.freeSlot}</div>;
  }
  return (
    <div className="book-slot book-typed">
      <span
        className="book-slot-spine"
        style={{
          height: `${3.6 + ((loan.id * 7) % 5) * 0.2}rem`,
          background: SPINE_COLORS[loan.id % SPINE_COLORS.length] ?? "#29405A",
        }}
      />
      <div>
        <p>{fill(es.homeBook.loanN, { n })}</p>
        <p>
          {fill(es.homeBook.dueOn, { date: formatDateTime(loan.due_at) })}{" "}
          {isOverdueDueAt(loan.due_at, loan.returned_at) ? (
            <StatusBadge tone="bad">{es.circulation.loanStatus.overdue}</StatusBadge>
          ) : null}
        </p>
      </div>
    </div>
  );
}

export function HomePage() {
  useDocumentTitle(es.routeTitles.home);
  const { user } = useAuth();
  const staff = canStaff(user);
  const reader = canRead(user);
  const reduced = useReducedMotion() ?? false;
  const recommendationsTitle = useRef<HTMLHeadingElement>(null);

  const loansQuery = useQuery({
    queryKey: ["circulation", "loans", "home"],
    queryFn: () => endpoints.circulation.listLoans({ limit: 100 }),
    enabled: reader,
    retry: 0,
    staleTime: 30_000,
  });
  const reservationsQuery = useQuery({
    queryKey: ["circulation", "reservations", "home"],
    queryFn: () => endpoints.circulation.listReservations({ limit: 100 }),
    enabled: reader,
    retry: 0,
    staleTime: 30_000,
  });
  const renewalsQuery = useQuery({
    queryKey: ["circulation", "renewals", "home"],
    queryFn: () => endpoints.circulation.listRenewals({ limit: 100 }),
    enabled: reader,
    retry: 0,
    staleTime: 30_000,
  });

  const loans = (loansQuery.data?.data ?? []).filter((loan) =>
    isMine(loan, user?.id ?? 0),
  );
  const loanById = new Map<number, LoanListRow>(loans.map((loan) => [loan.id, loan]));
  const activeLoans = loans.filter((loan) => !loan.returned_at);
  const readyReservations = (reservationsQuery.data?.data ?? []).filter(
    (reservation) =>
      isMine(reservation, user?.id ?? 0) && reservation.status === "ready",
  );
  const pendingRenewals = (renewalsQuery.data?.data ?? []).filter((renewal) => {
    if (renewal.status !== "pending") return false;
    if (!staff) return true;
    return loanById.get(renewal.loan_id)?.user_id === user?.id;
  });
  const dueSoon = [...activeLoans].sort(
    (a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime(),
  )[0];

  const loading =
    loansQuery.isPending || reservationsQuery.isPending || renewalsQuery.isPending;
  const failed =
    loansQuery.isError || reservationsQuery.isError || renewalsQuery.isError;
  const count = (n: number) => (loading || failed ? "—" : n);
  const retry = () => {
    void loansQuery.refetch();
    void reservationsQuery.refetch();
    void renewalsQuery.refetch();
  };

  const goToRecommendations = () => {
    const title = recommendationsTitle.current;
    if (!title) return;
    title.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    title.focus({ preventScroll: true });
  };

  if (!reader) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="display-title text-4xl">{es.home.title}</h1>
        <p className="mt-3">{es.homeBook.staffOnly}</p>
        <Button asChild className="mt-5">
          <Link to="/staff/requests">{es.nav.staffRequests}</Link>
        </Button>
      </div>
    );
  }

  const welcome = es.home.welcome.replace("{{name}}", user?.display_name ?? "");
  const shortcuts = [
    { to: "/catalog", label: es.home.shortcutCatalog, note: es.app.description },
    { to: "/me/circulation", label: es.home.shortcutLoans, note: es.circulation.intro },
    { to: "/me/preferences", label: es.home.shortcutPreferences, note: es.personalization.preferencesIntro },
  ];

  const pages = [
    // Spread 1, left: welcome
    <div key="welcome">
      <p className="book-eyebrow">{es.app.eyebrow}</p>
      <p className="book-display" aria-hidden="true">
        {welcome}
      </p>
      <p className="book-lede">{es.home.intro}</p>
    </div>,
    // Spread 1, right: index
    <nav key="index" aria-label={es.homeBook.indexTitle}>
      <h2 className="book-h2">{es.homeBook.indexTitle}</h2>
      <ul className="book-index">
        {shortcuts.map((shortcut) => (
          <li key={shortcut.to}>
            <Link to={shortcut.to}>
              <span className="book-index-title">{shortcut.label}</span>
              <span className="book-index-note">{shortcut.note}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>,
    // Spread 2, left: the desk (loan limit)
    <div key="desk" aria-busy={loansQuery.isPending}>
      <h2 className="book-h2">{es.homeBook.deskTitle}</h2>
      <p className="book-count book-typed">
        {fill(es.homeBook.deskCount, { count: loansQuery.isPending || loansQuery.isError ? "—" : activeLoans.length })}
      </p>
      {[0, 1].map((slot) => (
        <Slot key={slot} n={slot + 1} loan={activeLoans[slot]} loading={loansQuery.isPending} />
      ))}
      {failed ? (
        <div role="alert" className="book-note">
          <p className="book-note-title">{es.homeBook.loadError}</p>
          <p>{es.homeBook.loadErrorNext}</p>
          <button type="button" className="book-btn" onClick={retry}>
            {es.homeBook.retry}
          </button>
        </div>
      ) : null}
    </div>,
    // Spread 2, right: next return and pending items
    <div key="slip">
      <h2 className="book-h2">{es.homeBook.nextReturn}</h2>
      <div className="book-slip book-typed">
        {dueSoon ? (
          <p className="book-slip-body">
            <span>{formatDateTime(dueSoon.due_at)}</span>
            {isOverdueDueAt(dueSoon.due_at, dueSoon.returned_at) ? (
              <StatusBadge tone="bad">{es.circulation.loanStatus.overdue}</StatusBadge>
            ) : null}
          </p>
        ) : (
          <p className="book-slip-body">{loading ? "—" : es.home.noDueSoon}</p>
        )}
      </div>
      <dl className="book-dl">
        <div>
          <dt>{es.homeBook.readyReservations}</dt>
          <dd>{count(readyReservations.length)}</dd>
        </div>
        <div>
          <dt>{es.homeBook.pendingRenewals}</dt>
          <dd>{count(pendingRenewals.length)}</dd>
        </div>
      </dl>
      <p className="book-lede">
        <Link to="/me/circulation" className="book-link">
          {es.home.shortcutLoans}
        </Link>
      </p>
    </div>,
    // Spread 3, left: recommendations
    <div key="for-you">
      <h2 className="book-h2">{es.home.recommendations}</h2>
      <p className="book-lede">{es.home.recommendationsIntro}</p>
      <div className="book-actions">
        <button type="button" className="book-btn" onClick={goToRecommendations}>
          {es.homeBook.seeRecommendations}
        </button>
      </div>
    </div>,
    // Spread 3, right: tune what you see
    <div key="tune">
      <h2 className="book-h2">{es.homeBook.tuneTitle}</h2>
      <p className="book-lede">{es.personalization.preferencesIntro}</p>
      <div className="book-actions">
        <Link to="/me/preferences" className="book-btn">
          {es.home.shortcutPreferences}
        </Link>
        <Link to="/me/ratings" className="book-btn">
          {es.homeBook.ratingsLink}
        </Link>
      </div>
    </div>,
  ];

  return (
    <div className="space-y-10">
      <h1 className="sr-only">{welcome}</h1>

      <section className="home-desk">
        <FlipBook
          pages={pages}
          ribbons={es.homeBook.ribbons}
          labels={{
            group: es.homeBook.bookLabel,
            ribbons: es.homeBook.ribbonsLabel,
            prev: es.homeBook.prev,
            next: es.homeBook.next,
            position: (current, total) =>
              fill(es.homeBook.position, { current, total }),
          }}
        />
      </section>

      <section>
        <div className="mb-5 border-b border-[rgba(243,240,250,0.16)] pb-3">
          <h2
            ref={recommendationsTitle}
            tabIndex={-1}
            className="font-display text-3xl font-semibold text-ink"
          >
            {es.home.recommendations}
          </h2>
          <p className="mt-1 max-w-2xl text-[0.88rem] text-[rgba(243,240,250,0.64)]">
            {es.home.recommendationsIntro}
          </p>
        </div>
        <ForYouRecommendations limit={6} />
      </section>
    </div>
  );
}
