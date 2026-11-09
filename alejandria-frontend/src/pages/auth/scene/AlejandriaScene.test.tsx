import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AlejandriaScene } from "./AlejandriaScene";

describe("AlejandriaScene", () => {
  it("is decorative and contains no focusable elements", () => {
    const { container } = render(<AlejandriaScene mode="idle" />);
    const scene = container.querySelector(".auth-scene");
    expect(scene).toHaveAttribute("aria-hidden", "true");
    expect(scene?.querySelectorAll("a, button, input, select, textarea, [tabindex]")).toHaveLength(0);
  });
});
