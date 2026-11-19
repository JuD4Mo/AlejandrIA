import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { endpoints } from "@/api/endpoints";
import type { Interaction } from "@/api/types";

/** The most recent events window used to derive favourites and history. */
export const INTERACTION_WINDOW = 100;

export function useRecentInteractions(enabled: boolean) {
  return useQuery({
    queryKey: ["interactions", "me", INTERACTION_WINDOW],
    queryFn: () => endpoints.personalization.interactions({ limit: INTERACTION_WINDOW }),
    enabled,
    retry: 0,
    staleTime: 30_000,
  });
}

/**
 * The API stores favourites as an append-only event log
 * (favorite_added / favorite_removed) with no "list favourites" endpoint, so
 * the latest favourite event per book decides its state. Events are returned
 * newest first.
 */
export function favoriteBooks(events: Interaction[]): Map<number, Interaction> {
  const decided = new Set<number>();
  const favorites = new Map<number, Interaction>();
  for (const event of events) {
    if (event.interaction_type !== "favorite_added" && event.interaction_type !== "favorite_removed") continue;
    if (decided.has(event.book_id)) continue;
    decided.add(event.book_id);
    if (event.interaction_type === "favorite_added") favorites.set(event.book_id, event);
  }
  return favorites;
}

/** Distinct recently viewed books, newest first. */
export function recentlyViewed(events: Interaction[], limit = 8): Interaction[] {
  const seen = new Set<number>();
  const out: Interaction[] = [];
  for (const event of events) {
    if (event.interaction_type !== "view" || seen.has(event.book_id)) continue;
    seen.add(event.book_id);
    out.push(event);
    if (out.length >= limit) break;
  }
  return out;
}

export function useFavorites(enabled: boolean) {
  const queryClient = useQueryClient();
  const query = useRecentInteractions(enabled);
  const favorites = useMemo(() => favoriteBooks(query.data?.data ?? []), [query.data]);
  const toggle = useMutation({
    mutationFn: (input: { bookId: number; favorite: boolean }) =>
      endpoints.personalization.addInteraction({
        book_id: input.bookId,
        interaction_type: input.favorite ? "favorite_added" : "favorite_removed",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["interactions"] });
    },
  });
  return { query, favorites, toggle };
}
