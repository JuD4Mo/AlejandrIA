import { forwardRef, type InputHTMLAttributes } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/api/client";
import { endpoints } from "@/api/endpoints";
import type { NamedKind } from "@/api/types";
import { Input } from "@/components/ui/Field";
import { es, interpolate } from "@/i18n/es";

function parseId(value: unknown): number {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return 0;
  const id = Number(text);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

/**
 * Numeric identifier input that resolves the record name live.
 *
 * Works and authors come from the Goodreads import (hundreds of thousands of
 * rows), so a <select> with the first page would silently drop any value that
 * is not in that page. Identifiers are typed or pasted from the catalogue
 * management tabs instead, and the resolved name confirms the choice.
 */
export const EntityLookup = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { kind: NamedKind; lookupValue: unknown }
>(({ kind, lookupValue, ...props }, ref) => {
  const id = parseId(lookupValue);
  const query = useQuery({
    queryKey: ["named", kind, id],
    queryFn: () => endpoints.named.get(kind, id),
    enabled: id > 0,
    staleTime: 5 * 60_000,
    retry: 0,
  });
  const notFound = query.error instanceof ApiError && query.error.status === 404;
  return (
    <div>
      <Input ref={ref} inputMode="numeric" autoComplete="off" {...props} />
      <p className="mt-1 min-h-5 text-[0.78rem]" aria-live="polite">
        {id === 0 ? null : query.isPending ? (
          <span className="text-fg-subtle">{es.common.loading}…</span>
        ) : query.data ? (
          <span className="text-success">✓ {query.data.value}</span>
        ) : notFound ? (
          <span className="text-danger">{interpolate(es.staff.bookForm.lookupNotFound, { id })}</span>
        ) : (
          <span className="text-danger">{es.staff.bookForm.lookupError}</span>
        )}
      </p>
    </div>
  );
});
EntityLookup.displayName = "EntityLookup";
