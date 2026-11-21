import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endpoints } from "@/api/endpoints";
import { ApiError } from "@/api/client";
import type { RecommendationResponse } from "@/api/types";
import { es, interpolate } from "@/i18n/es";
import { ForYouRecommendations } from "./ForYouRecommendations";

vi.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ user: { id: 77 } }) }));
vi.mock("@/api/endpoints", () => ({
  endpoints: { personalization: { recommendations: vi.fn(), refreshRecommendations: vi.fn() } },
}));
vi.mock("./RecommendationGrid", () => ({
  RecommendationGrid: ({ response }: { response: RecommendationResponse }) => (
    <div>{response.recommendations.map((item) => <p key={item.goodreads_book_id}>{item.title}</p>)}</div>
  ),
}));

const request = vi.mocked(endpoints.personalization.recommendations);
const refreshRequest = vi.mocked(endpoints.personalization.refreshRecommendations);
const clients: QueryClient[] = [];
const response = (title: string): RecommendationResponse => ({
  status: "ok", source: "fastapi_v2", recommendation_type: "content", model_version: "v2", count: 1,
  recommendations: [{
    goodreads_book_id: title, local_book_id: null, in_local_catalog: false,
    local_title: null, total_copies: null, available_copies: null, available: null,
    title, authors: [], genres: [], score: 0.8, model: "content_cold_start",
    score_scope: "content_catalog", content_score: null, collaborative_score: null,
  }],
});
function renderRecommendations(cached?: RecommendationResponse) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  if (cached) client.setQueryData(["recommendations", "me", 77, 6], cached);
  return render(<QueryClientProvider client={client}><ForYouRecommendations /></QueryClientProvider>);
}
beforeEach(() => { request.mockReset(); refreshRequest.mockReset(); });
afterEach(() => clients.splice(0).forEach((client) => client.clear()));

describe("ForYouRecommendations regeneration", () => {
  it("polls an adapting local profile and stops once its hybrid is ready", async () => {
    vi.useFakeTimers();
    try {
      const state = { status: "pending" as const, input_count: 5, matched_count: 5, positive_count: 3, minimum_ratings: 5, revision: 5, processed_revision: 4 };
      request.mockResolvedValueOnce({ ...response("Contenido temporal"), fold_in: state })
        .mockResolvedValueOnce({ ...response("Híbrida local"), recommendation_type: "hybrid", profile_origin: "local_fold_in", fold_in: { ...state, status: "ready", processed_revision: 5 } });
      renderRecommendations();
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      expect(screen.getByText(es.recommendations.foldInUpdating)).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
      expect(screen.getByText(es.recommendations.foldInReady)).toBeInTheDocument();
      expect(screen.getByText("Híbrida local")).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(request).toHaveBeenCalledTimes(2);
      expect(refreshRequest).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("explains content fallback when too few ratings have collaborative mappings", async () => {
    request.mockResolvedValueOnce({ ...response("Por contenido"), fold_in: { status: "insufficient", input_count: 4, matched_count: 2, positive_count: 2, minimum_ratings: 5, revision: 4, processed_revision: 4 } });
    renderRecommendations();
    await screen.findByText(interpolate(es.recommendations.foldInInsufficient, { matched: 2, minimum: 5 }));
    expect(screen.getByText("Por contenido")).toBeInTheDocument();
  });
  it("identifies a simulated Goodreads profile explicitly", async () => {
    request.mockResolvedValueOnce({ ...response("Híbrida"), recommendation_type: "hybrid", profile_origin: "goodreads_test" });
    renderRecommendations();
    await screen.findByText(es.recommendations.historicalTestProfile);
    expect(screen.getByText("Híbrida")).toBeInTheDocument();
  });
  it("makes a fresh request, blocks duplicate clicks and keeps results while fetching", async () => {
    let complete!: (value: RecommendationResponse) => void;
    request.mockResolvedValueOnce(response("Primera selección"));
    refreshRequest.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const user = userEvent.setup();
    renderRecommendations();
    await screen.findByText("Primera selección");
    await user.click(screen.getByRole("button", { name: es.recommendations.generateNew }));
    const loading = screen.getByRole("button", { name: es.recommendations.generating });
    expect(loading).toBeDisabled();
    expect(loading).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Primera selección")).toBeInTheDocument();
    await user.click(loading);
    expect(request).toHaveBeenCalledTimes(1);
    expect(refreshRequest).toHaveBeenCalledTimes(1);
    expect(refreshRequest).toHaveBeenLastCalledWith(6, ["Primera selección"]);
    await act(async () => complete(response("Nueva selección")));
    await screen.findByText("Nueva selección");
    expect(screen.queryByText("Primera selección")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: es.recommendations.generateNew })).toBeEnabled();
    refreshRequest.mockResolvedValueOnce(response("Tercera selección"));
    await user.click(screen.getByRole("button", { name: es.recommendations.generateNew }));
    await screen.findByText("Tercera selección");
    expect(refreshRequest).toHaveBeenLastCalledWith(6, ["Nueva selección"]);
  });

  it("refetches even when the cached selection is still fresh", async () => {
    refreshRequest.mockResolvedValueOnce(response("Actualizada"));
    renderRecommendations(response("En caché"));
    expect(request).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: es.recommendations.generateNew }));
    await screen.findByText("Actualizada");
    expect(refreshRequest).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
  });

  it("preserves cached recommendations after failure and permits another attempt", async () => {
    request.mockResolvedValueOnce(response("Conservada"));
    refreshRequest.mockRejectedValueOnce(new ApiError(503, null)).mockResolvedValueOnce(response("Recuperada"));
    renderRecommendations();
    await screen.findByText("Conservada");
    await userEvent.click(screen.getByRole("button", { name: es.recommendations.generateNew }));
    await screen.findByRole("alert");
    expect(screen.getByText("Conservada")).toBeInTheDocument();
    expect(screen.getByText(es.recommendations.previousResults)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: es.recommendations.generateNew }));
    await screen.findByText("Recuperada");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("allows retrying an initial error using the same generate button", async () => {
    request.mockRejectedValueOnce(new ApiError(504, null));
    refreshRequest.mockResolvedValueOnce(response("Disponible"));
    renderRecommendations();
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: es.recommendations.generateNew })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: es.recommendations.generateNew }));
    await screen.findByText("Disponible");
    expect(request).toHaveBeenCalledTimes(1);
    expect(refreshRequest).toHaveBeenLastCalledWith(6, []);
  });

  it("hides cached results when the reader no longer has permission", async () => {
    refreshRequest.mockRejectedValueOnce(new ApiError(403, null));
    renderRecommendations(response("Selección privada"));
    await userEvent.click(screen.getByRole("button", { name: es.recommendations.generateNew }));
    await screen.findByText(es.recommendations.forbiddenTitle);
    expect(screen.queryByText("Selección privada")).not.toBeInTheDocument();
  });
});
