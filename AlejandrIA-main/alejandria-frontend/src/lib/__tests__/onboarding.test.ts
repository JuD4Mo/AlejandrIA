import { describe, expect, it } from "vitest";
import type { NamedEntity } from "@/api/types";
import { resolveGenreIds, selectedOptionLabels } from "@/lib/onboarding";

const genres: NamedEntity[] = [
  { id: 1, value: "Fantasía" },
  { id: 2, value: "Ciencia ficción" },
  { id: 3, value: "Distopía" },
  { id: 4, value: "Misterio" },
  { id: 5, value: "Suspense" },
];

describe("onboarding genre resolution", () => {
  it("maps answers to existing genres without duplicates", () => {
    const ids = resolveGenreIds(
      {
        atmosphere: "imagined",
        drive: "riddle",
      },
      genres,
    );
    expect(ids.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it("ignores genres that are not in the catalog yet", () => {
    expect(
      resolveGenreIds({ atmosphere: "journey" }, genres),
    ).toEqual([]);
  });

  it("returns the chosen option labels in question order", () => {
    expect(
      selectedOptionLabels({
        horizon: "classics",
        atmosphere: "tension",
      }),
    ).toEqual(["Misterio y tensión", "Obras clásicas"]);
  });
});
