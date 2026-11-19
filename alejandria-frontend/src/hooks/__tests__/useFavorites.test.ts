import { describe, expect, it } from "vitest";
import type { Interaction } from "@/api/types";
import { favoriteBooks, recentlyViewed } from "@/hooks/useFavorites";

let nextId = 1;
function event(book_id: number, interaction_type: Interaction["interaction_type"]): Interaction {
  return {
    id: nextId++,
    book_id,
    title: `Libro ${book_id}`,
    goodreads_book_id: null,
    interaction_type,
    occurred_at: "2026-11-18T10:00:00Z",
  };
}

describe("favoriteBooks", () => {
  it("uses the newest favourite event per book (events arrive newest first)", () => {
    const events = [
      event(1, "favorite_removed"),
      event(2, "view"),
      event(2, "favorite_added"),
      event(1, "favorite_added"),
      event(3, "favorite_added"),
      event(3, "favorite_removed"),
    ];
    expect([...favoriteBooks(events).keys()]).toEqual([2, 3]);
  });

  it("ignores views and recommendation clicks", () => {
    expect(favoriteBooks([event(4, "view"), event(5, "recommendation_click")]).size).toBe(0);
  });
});

describe("recentlyViewed", () => {
  it("returns distinct viewed books, newest first, up to the limit", () => {
    const events = [event(1, "view"), event(2, "favorite_added"), event(1, "view"), event(3, "view"), event(4, "view")];
    expect(recentlyViewed(events, 2).map((item) => item.book_id)).toEqual([1, 3]);
  });
});
