import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { canAdmin, canRead, canStaff, landingPath } from "./capabilities";
import { PageLoader } from "@/components/ui/Loading";
import { es } from "@/i18n/es";

function loginRedirect(pathname: string, search: string, hash: string): string {
  const from = `${pathname}${search}${hash}`;
  return `/login?next=${encodeURIComponent(from)}`;
}

export function RequireAuth({ children }: { children?: ReactNode }) {
  const { isLoading, token, user } = useAuth();
  const location = useLocation();

  if (isLoading) return <PageLoader label={es.common.loading} />;
  if (!token) {
    return (
      <Navigate
        to={loginRedirect(location.pathname, location.search, location.hash)}
        replace
      />
    );
  }
  if (!user) return <PageLoader label={es.common.loading} />;
  return <>{children ?? <Outlet />}</>;
}

export function RequireRead({ children }: { children?: ReactNode }) {
  const { user } = useAuth();
  if (!canRead(user)) return <Navigate to="/403" replace />;
  return <>{children ?? <Outlet />}</>;
}

export function RequireStaff({ children }: { children?: ReactNode }) {
  const { user } = useAuth();
  if (!canStaff(user)) return <Navigate to="/403" replace />;
  return <>{children ?? <Outlet />}</>;
}

export function RequireAdmin({ children }: { children?: ReactNode }) {
  const { user } = useAuth();
  if (!canAdmin(user)) return <Navigate to="/403" replace />;
  return <>{children ?? <Outlet />}</>;
}

export function PublicOnly({ children }: { children?: ReactNode }) {
  const { isLoading, token, user } = useAuth();
  if (isLoading) return <PageLoader label={es.common.loading} />;
  if (token && user) return <Navigate to={landingPath(user)} replace />;
  return <>{children ?? <Outlet />}</>;
}
