import { useEffect } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { canRead, landingPath } from "@/auth/capabilities";
import {
  PublicOnly,
  RequireAdmin,
  RequireAuth,
  RequireRead,
  RequireStaff,
} from "@/auth/guards";
import { AppShell } from "@/components/AppShell";
import { OnboardingGate } from "@/components/onboarding/OnboardingGate";
import { AccountPage } from "@/pages/AccountPage";
import { BookPage } from "@/pages/BookPage";
import { CatalogPage } from "@/pages/CatalogPage";
import { ForbiddenPage } from "@/pages/ForbiddenPage";
import { HomePage } from "@/pages/HomePage";
import { MyCirculationPage } from "@/pages/MyCirculationPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { PreferencesPage } from "@/pages/PreferencesPage";
import { RatingsPage } from "@/pages/RatingsPage";
import { AdminUsersPage } from "@/pages/admin/AdminUsersPage";
import { LoginPage } from "@/pages/auth/LoginPage";
import { RegisterPage } from "@/pages/auth/RegisterPage";
import { BookFormPage } from "@/pages/staff/BookFormPage";
import { StaffCatalogPage } from "@/pages/staff/StaffCatalogPage";
import { StaffCopiesPage } from "@/pages/staff/StaffCopiesPage";
import { StaffLoansPage } from "@/pages/staff/StaffLoansPage";
import { StaffRenewalsPage } from "@/pages/staff/StaffRenewalsPage";
import { StaffRequestsPage } from "@/pages/staff/StaffRequestsPage";
import { StaffReservationsPage } from "@/pages/staff/StaffReservationsPage";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [pathname]);
  return null;
}

/**
 * "/" is the reading room for readers. Staff-only accounts have no reading
 * capability (the API answers 403 to /users/me/*), so they are sent to their
 * own landing page instead of the forbidden screen.
 */
function AuthenticatedIndex() {
  const { user } = useAuth();
  if (canRead(user)) return <HomePage />;
  return <Navigate to={landingPath(user)} replace />;
}

export function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route element={<PublicOnly />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>

        <Route element={<RequireAuth />}>
          <Route
            element={
              <OnboardingGate>
                <AppShell />
              </OnboardingGate>
            }
          >
            <Route index element={<AuthenticatedIndex />} />
            <Route
              path="catalog"
              element={<RequireRead><CatalogPage /></RequireRead>}
            />
            <Route
              path="books/:id"
              element={<RequireRead><BookPage /></RequireRead>}
            />
            <Route
              path="me/circulation"
              element={<RequireRead><MyCirculationPage /></RequireRead>}
            />
            <Route
              path="me/preferences"
              element={<RequireRead><PreferencesPage /></RequireRead>}
            />
            <Route
              path="me/ratings"
              element={<RequireRead><RatingsPage /></RequireRead>}
            />
            <Route path="account" element={<AccountPage />} />

            <Route
              path="staff/requests"
              element={<RequireStaff><StaffRequestsPage /></RequireStaff>}
            />
            <Route
              path="staff/loans"
              element={<RequireStaff><StaffLoansPage /></RequireStaff>}
            />
            <Route
              path="staff/renewals"
              element={<RequireStaff><StaffRenewalsPage /></RequireStaff>}
            />
            <Route
              path="staff/reservations"
              element={<RequireStaff><StaffReservationsPage /></RequireStaff>}
            />
            <Route
              path="staff/catalog"
              element={<RequireStaff><StaffCatalogPage /></RequireStaff>}
            />
            <Route
              path="staff/catalog/books/new"
              element={<RequireStaff><BookFormPage /></RequireStaff>}
            />
            <Route
              path="staff/catalog/books/:id/edit"
              element={<RequireStaff><BookFormPage /></RequireStaff>}
            />
            <Route
              path="staff/catalog/books/:id/copies"
              element={<RequireStaff><StaffCopiesPage /></RequireStaff>}
            />
            <Route
              path="admin/users"
              element={<RequireAdmin><AdminUsersPage /></RequireAdmin>}
            />

            <Route path="403" element={<ForbiddenPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
