import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { canAdmin, canRead, canStaff, landingPath } from "@/auth/capabilities";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { es } from "@/i18n/es";

interface NavItem {
  to: string;
  label: string;
}

function useNavGroups() {
  const { user } = useAuth();
  const groups: { label: string; items: NavItem[] }[] = [];
  if (canRead(user)) {
    groups.push({
      label: es.nav.groupReading,
      items: [
        { to: "/", label: es.nav.home },
        { to: "/catalog", label: es.nav.catalog },
        { to: "/me/circulation", label: es.nav.circulation },
        { to: "/me/preferences", label: es.nav.preferences },
        { to: "/me/ratings", label: es.nav.ratings },
      ],
    });
  }

  if (canStaff(user)) {
    groups.push({
      label: es.nav.groupStaff,
      items: [
        { to: "/staff/requests", label: es.nav.staffRequests },
        { to: "/staff/loans", label: es.nav.staffLoans },
        { to: "/staff/renewals", label: es.nav.staffRenewals },
        { to: "/staff/reservations", label: es.nav.staffReservations },
        { to: "/staff/catalog", label: es.nav.staffCatalog },
      ],
    });
  }

  if (canAdmin(user)) {
    groups.push({
      label: es.nav.groupAdmin,
      items: [{ to: "/admin/users", label: es.nav.adminUsers }],
    });
  }
  return groups;
}

function BrandMark() {
  return (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="relative flex size-9 items-center justify-center border border-brass bg-walnut font-display text-xl font-semibold text-lamp"
      >
        A
        <span className="absolute inset-x-2 bottom-1.5 h-px bg-brass" />
      </span>
      <span className="leading-none">
        <span className="block font-display text-2xl font-semibold tracking-tight text-ficha">
          {es.app.name}
        </span>
        <span className="mt-1 block text-[0.63rem] text-[rgba(232,228,216,0.64)]">
          {es.app.eyebrow}
        </span>
      </span>
    </span>
  );
}

function navClass({ isActive }: { isActive: boolean }) {
  return cn(
    "relative whitespace-nowrap px-2 py-1 text-[0.82rem] font-semibold text-[rgba(232,228,216,0.78)] transition-colors hover:text-lamp",
    isActive &&
      "text-lamp after:absolute after:inset-x-2 after:-bottom-1 after:h-px after:bg-brass",
  );
}

export function AppShell() {
  const { user, logout, flash, clearFlash } = useAuth();
  const groups = useNavGroups();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  // Staff/admin accounts carry several nav sections; give them their own row.
  const wideNav = groups.length > 1;
  const headerRef = useRef<HTMLElement>(null);

  // Sticky toolbars below the header offset themselves by its real height.
  useEffect(() => {
    const header = headerRef.current;
    if (!header || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => {
      root.style.setProperty("--header-h", `${header.offsetHeight}px`);
    });
    observer.observe(header);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--header-h");
    };
  }, []);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(clearFlash, 6000);
    return () => window.clearTimeout(timer);
  }, [flash, clearFlash]);

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-surface focus:px-4 focus:py-2"
      >
        Saltar al contenido
      </a>
      <header ref={headerRef} className="sticky top-0 z-30 room-chrome border-b border-[rgba(232,228,216,0.2)]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
          <Link
            to={landingPath(user)}
            className="shrink-0 no-underline"
            aria-label={es.app.name}
          >
            <BrandMark />
          </Link>

          <nav
            aria-label="Principal"
            className={cn(
              "hidden min-w-0 items-center gap-5 lg:flex",
              wideNav ? "order-last basis-full flex-wrap gap-y-1 border-t border-[rgba(232,228,216,0.12)] pt-2" : "flex-1",
            )}
          >
            {groups.map((group) => (
              <div key={group.label} className="flex items-center gap-1">
                {group.label !== es.nav.groupReading ? (
                  <span className="mr-1 h-4 w-px bg-[rgba(232,228,216,0.24)]" />
                ) : null}
                {group.items.map((item) => (
                  <NavLink key={item.to} to={item.to} className={navClass} end={item.to === "/"}>
                    {item.label}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>

          <div className="hidden items-center gap-3 lg:flex">
            <Link
              to="/account"
              className="max-w-40 truncate text-[0.78rem] text-fg-subtle no-underline hover:text-accent"
            >
              {user?.display_name}
            </Link>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                logout();
                navigate("/login", { replace: true });
              }}
            >
              {es.nav.logout}
            </Button>
          </div>

          <div className="flex items-center gap-2 lg:hidden">
            <Link
              to="/account"
              className="max-w-28 truncate text-[0.72rem] text-fg-subtle no-underline"
            >
              {user?.display_name}
            </Link>
            <Button
              variant="secondary"
              size="sm"
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? es.nav.close : es.nav.menu}
            </Button>
          </div>
        </div>
        {menuOpen ? (
          <div
            id="mobile-nav"
            className="border-t border-line bg-surface px-4 py-4 lg:hidden"
          >
            <nav aria-label="Principal móvil" className="space-y-4">
              {groups.map((group) => (
                <div key={group.label}>
                  <p className="mb-1 text-[0.68rem] font-semibold text-fg-subtle">
                    {group.label}
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {group.items.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.to === "/"}
                        className={navClass}
                        onClick={() => setMenuOpen(false)}
                      >
                        {item.label}
                      </NavLink>
                    ))}
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-line pt-3">
                <Link to="/account" className="text-[0.8rem] font-semibold">
                  {es.nav.account}
                </Link>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    logout();
                    navigate("/login", { replace: true });
                  }}
                >
                  {es.nav.logout}
                </Button>
              </div>
            </nav>
          </div>
        ) : null}
      </header>

      {flash ? (
        <div
          role="status"
          className="notice notice--warning border-l-0 border-b border-b-line text-center"
        >
          {flash}
        </div>
      ) : null}

      <main
        id="main"
        className="route-enter mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8"
      >
        <Outlet />
      </main>

      <footer className="mt-auto border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-6 text-[0.75rem] text-fg-subtle sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p className="m-0">{es.app.tagline}</p>
          <p className="m-0">{es.app.description}</p>
        </div>
      </footer>
    </div>
  );
}
