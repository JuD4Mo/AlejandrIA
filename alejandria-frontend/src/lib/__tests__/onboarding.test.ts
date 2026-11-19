import { describe, expect, it } from "vitest";
import type { NamedEntity } from "@/api/types";
import { es } from "@/i18n/es";
import { resolveGenreIds, selectedOptionLabels } from "@/lib/onboarding";

// The ten Goodreads labels exactly as imported (docs/database/importacion_goodreads.md).
const genres: NamedEntity[] = [
  { id: 1, value: "children" },
  { id: 2, value: "comics, graphic" },
  { id: 3, value: "fantasy, paranormal" },
  { id: 4, value: "fiction" },
  { id: 5, value: "history, historical fiction, biography" },
  { id: 6, value: "mystery, thriller, crime" },
  { id: 7, value: "non-fiction" },
  { id: 8, value: "poetry" },
  { id: 9, value: "romance" },
  { id: 10, value: "young-adult" },
];

describe("onboarding genre resolution", () => {
  it("maps answers to the imported Goodreads genres without duplicates", () => {
    const ids = resolveGenreIds(
      {
        atmosphere: "imagined",
        drive: "riddle",
        refuge: "puzzles",
      },
      genres,
    );
    expect(ids.sort((a, b) => a - b)).toEqual([2, 3, 6]);
  });

  it("produces at least one genre for every option against the imported catalog", () => {
    for (const question of es.onboarding.questions) {
      for (const option of question.options) {
        expect(
          resolveGenreIds({ [question.id]: option.id }, genres).length,
          `${question.id}.${option.id}`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("also matches staff-created genres by their Spanish display name", () => {
    expect(resolveGenreIds({ atmosphere: "words" }, [{ id: 42, value: "Poesía" }])).toEqual([42]);
  });

  it("ignores genres that are not in the catalog yet", () => {
    expect(resolveGenreIds({ atmosphere: "journey" }, [{ id: 1, value: "poetry" }])).toEqual([]);
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
