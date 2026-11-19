import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthProvider";
import { canAdmin } from "@/auth/capabilities";
import { es } from "@/i18n/es";
import { endpoints } from "@/api/endpoints";
import { cn } from "@/lib/cn";

export function PageLoader({ label = "Cargando" }: { label?: string }) {
  return (
    <div
      className="flex min-h-[40vh] items-center justify-center gap-3 text-fg-subtle"
      role="status"
    >
      <span
        className="inline-block size-4 animate-spin rounded-full border border-line-strong border-t-lamp"
        aria-hidden="true"
      />
      <span className="text-[0.9rem]">{label}</span>
    </div>
  );
}

export function BookLabel({
  bookId,
  className,
  inline = false,
}: {
  bookId: number;
  className?: string;
  inline?: boolean;
}) {
  const queries = useQueries({
    queries: [
      {
        queryKey: ["books", bookId],
        queryFn: () => endpoints.books.get(bookId),
        staleTime: 5 * 60_000,
        retry: 0,
      },
    ],
  });
  const book = queries[0]?.data;
  return (
    <span className={cn(inline ? "inline" : "block truncate", className)}>
      {book ? book.title : `Libro #${bookId}`}
    </span>
  );
}

export function CopyLabel({
  bookId,
  copyId,
  className,
}: {
  bookId: number;
  copyId: number;
  className?: string;
}) {
  const queries = useQueries({
    queries: [
      {
        queryKey: ["copies", bookId, "lookup"],
        queryFn: () => endpoints.copies.list(bookId, { limit: 100 }),
        staleTime: 2 * 60_000,
        retry: 0,
      },
    ],
  });
  const copy = useMemo(
    () => queries[0]?.data?.copies.find((item) => item.id === copyId),
    [queries, copyId],
  );
  return (
    <span className={cn("inline font-tabular", className)}>
      {copy ? copy.inventory_code : `Ejemplar #${copyId}`}
    </span>
  );
}

/**
 * Reader name for staff queues. Only administrators may call GET /users, so
 * librarians keep the "Lector #id" reference the API exposes to them.
 */
export function ReaderLabel({ userId }: { userId: number }) {
  const { user } = useAuth();
  const admin = canAdmin(user);
  const directory = useQuery({
    queryKey: ["users", "directory"],
    queryFn: () => endpoints.users.list({ limit: 100 }),
    enabled: admin,
    staleTime: 5 * 60_000,
    retry: 0,
  });
  const reader = directory.data?.data.find((candidate) => candidate.id === userId);
  const fallback = es.circulation.unknownReader.replace("{{id}}", String(userId));
  return <span>{reader ? `${reader.display_name} · #${userId}` : fallback}</span>;
}
