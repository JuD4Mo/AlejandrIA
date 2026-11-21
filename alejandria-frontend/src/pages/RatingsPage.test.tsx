import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endpoints } from "@/api/endpoints";
import type { HistoricalRatings } from "@/api/types";
import { ApiError } from "@/api/client";
import { es } from "@/i18n/es";
import { RatingsPage } from "./RatingsPage";

const session = vi.hoisted(() => ({ user: { id: 4, recommendation_profile: "goodreads_test" as "local" | "goodreads_test" } }));
vi.mock("@/auth/AuthProvider", () => ({ useAuth: () => session }));
vi.mock("@/api/endpoints", () => ({ endpoints: { personalization: {
  historicalRatings: vi.fn(), ratings: vi.fn(), putRating: vi.fn(), deleteRating: vi.fn(),
} } }));
const historical = vi.mocked(endpoints.personalization.historicalRatings);
const local = vi.mocked(endpoints.personalization.ratings);
const clients: QueryClient[] = [];
const page = (offset: number, size: number): HistoricalRatings => ({
  source: "goodreads_train", model_version: "v2", total: 21, positive_count: 21, limit: 20, offset,
  data: Array.from({ length: size }, (_, i) => ({
    goodreads_book_id: `000${offset + i + 1}`, local_book_id: offset + i + 1,
    title: `Histórico ${offset + i + 1}`, authors: ["Autora"], genres: ["poetry"], rating: 5,
  })),
});
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  render(<MemoryRouter><QueryClientProvider client={client}><RatingsPage /></QueryClientProvider></MemoryRouter>);
}
beforeEach(() => {
  vi.resetAllMocks();
  session.user.recommendation_profile = "goodreads_test";
  local.mockResolvedValue({ data: [], pagination: { limit: 20, offset: 0 } });
});
afterEach(() => clients.splice(0).forEach((client) => client.clear()));

describe("RatingsPage data provenance", () => {
  it("opens the historical profile read-only, preserves local book links and paginates", async () => {
    historical.mockResolvedValueOnce(page(0, 20)).mockResolvedValueOnce(page(20, 1));
    show();
    await screen.findByText("Histórico 1");
    expect(screen.getByRole("tab", { name: es.personalization.historicalRatingsTab })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(es.personalization.historicalRatingsNotice)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Histórico 1" })).toHaveAttribute("href", "/books/1");
    expect(screen.queryByRole("button", { name: es.personalization.removeRating })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: es.meta.starButton.replace("{{rating}}", "5") })).not.toBeInTheDocument();
    expect(local).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: es.common.loadMore }));
    await screen.findByText("Histórico 21");
    expect(historical).toHaveBeenLastCalledWith({ limit: 20, offset: 20 });
    expect(screen.queryByRole("button", { name: es.common.loadMore })).not.toBeInTheDocument();
    expect(endpoints.personalization.putRating).not.toHaveBeenCalled();
    expect(endpoints.personalization.deleteRating).not.toHaveBeenCalled();
  });

  it("keeps the local empty state separate from existing historical ratings", async () => {
    historical.mockResolvedValueOnce(page(0, 20));
    show();
    await screen.findByText("Histórico 1");
    await userEvent.click(screen.getByRole("tab", { name: es.personalization.localRatingsTab }));
    await screen.findByText(es.personalization.noRatings);
    expect(screen.queryByText("Histórico 1")).not.toBeInTheDocument();
    expect(local).toHaveBeenCalledWith({ limit: 20, offset: 0 });
  });

  it("does not request historical data for a normal local account", async () => {
    session.user.recommendation_profile = "local";
    show();
    await screen.findByText(es.personalization.noRatings);
    expect(historical).not.toHaveBeenCalled();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("allows local ratings to remain accessible when the historical service fails", async () => {
    historical.mockRejectedValueOnce(new ApiError(503, null));
    show();
    await screen.findByRole("alert");
    await userEvent.click(screen.getByRole("tab", { name: es.personalization.localRatingsTab }));
    await screen.findByText(es.personalization.noRatings);
  });
});
