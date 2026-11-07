import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { landingPath } from "@/auth/capabilities";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { es } from "@/i18n/es";

export function NotFoundPage() {
  useDocumentTitle(es.routeTitles.notFound);
  const { user } = useAuth();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={es.errors.notFoundTitle} />
      <EmptyState
        title={es.errors.notFound}
        body={es.errors.notFoundHint}
        action={
          <Button asChild variant="secondary">
            <Link to={user ? landingPath(user) : "/login"}>
              {es.errors.goHome}
            </Link>
          </Button>
        }
      />
    </div>
  );
}
