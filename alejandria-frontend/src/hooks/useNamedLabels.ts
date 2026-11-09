import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { endpoints } from "@/api/endpoints";
import type { NamedKind } from "@/api/types";

export function useNamedLabels(
  kind: NamedKind,
  ids: number[],
): { labels: Map<number, string>; loading: boolean } {
  const unique = useMemo(() => [...new Set(ids)].filter((id) => id > 0), [ids]);
  const queries = useQueries({
    queries: unique.map((id) => ({
      queryKey: ["named", kind, id],
      queryFn: () => endpoints.named.get(kind, id),
      staleTime: 5 * 60_000,
      retry: 0,
    })),
  });

  const labels = useMemo(() => {
    const map = new Map<number, string>();
    unique.forEach((id, index) => {
      const data = queries[index]?.data;
      if (data) map.set(id, data.value);
    });
    return map;
  }, [unique, queries]);

  return {
    labels,
    loading: queries.some((query) => query.isPending),
  };
}

export function useBookTitles(ids: number[]): Map<number, string> {
  const unique = useMemo(() => [...new Set(ids)].filter((id) => id > 0), [ids]);
  const queries = useQueries({
    queries: unique.map((id) => ({
      queryKey: ["books", id],
      queryFn: () => endpoints.books.get(id),
      staleTime: 5 * 60_000,
      retry: 0,
    })),
  });
  const titles = new Map<number, string>();
  unique.forEach((id, index) => {
    const book = queries[index]?.data;
    if (book) titles.set(id, book.title);
  });
  return titles;
}
