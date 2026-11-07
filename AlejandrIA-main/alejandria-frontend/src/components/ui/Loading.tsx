import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { endpoints } from "@/api/endpoints";
import { cn } from "@/lib/cn";

export function PageLoader({ label = "Cargando" }: { label?: string }) {
  return (
    <div
      className="flex min-h-[40vh] items-center justify-center gap-3 text-[rgba(243,240,250,0.62)]"
      role="status"
    >
      <span
        className="inline-block size-4 animate-spin rounded-full border border-[rgba(243,240,250,0.24)] border-t-oxblood"
        aria-hidden="true"
      />
      <span className="text-[0.9rem]">{label}</span>
    </div>
  );
}

export function BookLabel({
  bookId,
  className,
}: {
  bookId: number;
  className?: string;
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
    <span className={cn("block truncate", className)}>
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
    <span className={cn("block truncate font-tabular", className)}>
      {copy ? copy.inventory_code : `Ejemplar #${copyId}`}
    </span>
  );
}
