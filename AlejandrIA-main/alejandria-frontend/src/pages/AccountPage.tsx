import { useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { formatDate } from "@/lib/dates";
import { es } from "@/i18n/es";

export function AccountPage() {
  useDocumentTitle(es.routeTitles.account);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  if (!user) return null;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={es.account.title} description={es.account.subtitle} />
      <dl className="paper-panel grid gap-0 sm:grid-cols-2">
        {[
          [es.account.email, user.email],
          [es.account.displayName, user.display_name],
          [es.account.created, formatDate(user.created_at)],
          [es.common.id, String(user.id)],
        ].map(([label, value]) => (
          <div
            key={label}
            className="border-b border-[rgba(243,240,250,0.12)] px-5 py-4 last:border-b-0 sm:border-r sm:[&:nth-child(even)]:border-r-0"
          >
            <dt className="text-[0.72rem] font-semibold text-[rgba(243,240,250,0.52)]">
              {label}
            </dt>
            <dd className="mt-1 break-words text-[0.92rem] text-ink">{value}</dd>
          </div>
        ))}
        <div className="border-b border-[rgba(243,240,250,0.12)] px-5 py-4 sm:border-b-0 sm:border-r">
          <dt className="text-[0.72rem] font-semibold text-[rgba(243,240,250,0.52)]">
            {es.account.roles}
          </dt>
          <dd className="mt-2 flex flex-wrap gap-1.5">
            {user.roles.length ? (
              user.roles.map((role) => (
                <StatusBadge key={role} tone="neutral">
                  {es.roles[role]}
                </StatusBadge>
              ))
            ) : (
              <span className="text-[0.85rem] text-[rgba(243,240,250,0.6)]">
                {es.account.noRoles}
              </span>
            )}
          </dd>
        </div>
        <div className="px-5 py-4">
          <dt className="text-[0.72rem] font-semibold text-[rgba(243,240,250,0.52)]">
            {es.account.active}
          </dt>
          <dd className="mt-2">
            <StatusBadge tone={user.is_active ? "good" : "bad"}>
              {user.is_active ? es.common.yes : es.common.no}
            </StatusBadge>
          </dd>
        </div>
      </dl>

      <section className="mt-8 border-t border-[rgba(243,240,250,0.16)] pt-6">
        <h2 className="font-display text-2xl font-semibold text-ink">
          {es.account.session}
        </h2>
        <p className="mt-2 max-w-xl text-[0.88rem] leading-relaxed text-[rgba(243,240,250,0.68)]">
          {es.account.sessionNote}
        </p>
        <Button
          variant="danger"
          className="mt-4"
          onClick={() => {
            logout();
            navigate("/login", { replace: true });
          }}
        >
          {es.account.logout}
        </Button>
      </section>
    </div>
  );
}
