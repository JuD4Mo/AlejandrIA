import { describe, expect, it } from "vitest";
import { CLOTH, contrastRatio, readableOn } from "./tokens";

describe("spine cloth palette", () => {
  it.each(Object.entries(CLOTH))("%s keeps 4.5:1 with its computed text color", (_name, hex) => {
    expect(contrastRatio(hex, readableOn(hex))).toBeGreaterThanOrEqual(4.5);
  });

  it("picks light text on dark cloth and dark text on light cloth", () => {
    expect(readableOn("#29405A")).toBe("#F4F1E6");
    expect(readableOn("#D9D2BE")).toBe("#1B1A17");
  });
});
