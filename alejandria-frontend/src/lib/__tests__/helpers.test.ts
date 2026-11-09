import { describe, expect, it } from "vitest";
import { passwordByteLength, passwordProblem } from "@/lib/password";
import { recommendationErrorKind, recommendationViewState } from "@/lib/recommendations";
import {
  canAdmin,
  canRead,
  canStaff,
  landingPath,
} from "@/auth/capabilities";
import { spineDesign, spineInitial } from "@/lib/covers";
import type { User } from "@/api/types";
import { ApiError } from "@/api/client";
import type { RecommendationResponse } from "@/api/types";

const base: RecommendationResponse = {
  status: "ok",
  source: "test",
  recommendation_type: "content",
  model_version: "1",
  count: 1,
  recommendations: [
    {
      goodreads_book_id: "000123",
      local_book_id: 7,
      in_local_catalog: true,
      local_title: "Libro",
      total_copies: 2,
      available_copies: 1,
      available: true,
      title: "Libro",
      authors: ["Autora"],
      genres: ["Novela"],
      score: 0.9,
      model: "content_similar",
      score_scope: "test",
      content_score: 0.9,
      collaborative_score: null,
    },
  ],
};

function userWith(roles: User["roles"]): User {
  return {
    id: 1,
    email: "persona@example.com",
    display_name: "Persona",
    roles,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
  };
}

describe("capabilities", () => {
  it("separates reading, staff and admin access", () => {
    const librarian = userWith(["bibliotecario"]);
    expect(canRead(librarian)).toBe(false);
    expect(canStaff(librarian)).toBe(true);
    expect(canAdmin(librarian)).toBe(false);
    expect(landingPath(librarian)).toBe("/staff/requests");

    const admin = userWith(["administrador"]);
    expect(canRead(admin)).toBe(true);
    expect(canStaff(admin)).toBe(true);
    expect(canAdmin(admin)).toBe(true);
    expect(landingPath(admin)).toBe("/");
    expect(landingPath(userWith(["lector"]))).toBe("/");
    expect(landingPath(null)).toBe("/403");
  });
});

describe("typographic covers", () => {
  it("is deterministic and falls back to the shelving initial", () => {
    expect(spineDesign("Cien años de soledad", ["Novela"])).toEqual(
      spineDesign("cien años de soledad", ["novela"]),
    );
    expect(spineInitial("  el túnel")).toBe("E");
    expect(spineInitial("   ")).toBe("A");
  });
});

describe("password validation", () => {
  it("requires 12 characters and at most 72 bytes", () => {
    expect(passwordProblem("corta")).toBe("tooShort");
    expect(passwordProblem("docecaracteres")).toBeNull();
    expect(passwordProblem("ñ".repeat(40))).toBe("tooLong");
    expect(passwordByteLength("ñ")).toBe(2);
  });
});

describe("recommendation view state", () => {
  it("maps statuses without interpreting scores", () => {
    expect(recommendationViewState(base).kind).toBe("ok");
    expect(
      recommendationViewState({ ...base, status: "preferences_required" }).kind,
    ).toBe("preferences_required");
    expect(
      recommendationViewState({ ...base, status: "no_content_matches" }).kind,
    ).toBe("no_content_matches");
    expect(
      recommendationViewState({ ...base, count: 0, recommendations: [] }).kind,
    ).toBe("empty");
  });

  it("maps similar 404/409 to the quiet empty state", () => {
    expect(
      recommendationErrorKind(
        new ApiError(404, {
          code: "NOT_FOUND",
          message: "missing",
          status: 404,
          override: false,
          errors: null,
          action: null,
        }),
      ),
    ).toBe("no_similar");
    expect(recommendationErrorKind(new ApiError(503, null))).toBe(
      "service_unavailable",
    );
  });
});
