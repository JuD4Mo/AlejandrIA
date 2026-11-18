import type { ReactNode } from "react";
import { mapApiError } from "@/lib/errors";
import { es } from "@/i18n/es";
import { cn } from "@/lib/cn";
import { Button } from "./Button";

export function ErrorState({
  error,
  onRetry,
  compact = false,
  action,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  compact?: boolean;
  action?: ReactNode;
  className?: string;
}) {
  const mapped = mapApiError(error);
  return (
    <div
      role="alert"
      className={cn(
        compact
          ? "border-l-[3px] border-danger bg-danger/10 px-4 py-3"
          : "paper-panel border-l-4 border-l-oxblood px-6 py-6 sm:px-8",
        className,
      )}
    >
      <h2
        className={
          compact
            ? "text-[0.88rem] font-semibold text-danger"
            : "font-display text-2xl font-semibold text-fg"
        }
      >
        {mapped.title}
      </h2>
      <p className="mt-1 max-w-xl text-[0.9rem] leading-relaxed text-fg-muted">
        {mapped.message}
      </p>
      <p className="mt-1 text-[0.84rem] text-fg-subtle">
        {mapped.next}
      </p>
      {mapped.detail ? (
        <p className="mt-2 text-[0.78rem] text-fg-subtle">
          {es.errors.messageFromServer}: {mapped.detail}
        </p>
      ) : null}
      {onRetry || action ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {onRetry ? (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              {es.errors.retry}
            </Button>
          ) : null}
          {action}
        </div>
      ) : null}
    </div>
  );
}
