import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "../Button";

describe("Button", () => {
  it("slots a single child when using asChild", () => {
    render(
      <Button asChild>
        <a href="/catalog">Catálogo</a>
      </Button>,
    );

    const link = screen.getByRole("link", { name: "Catálogo" });
    expect(link.getAttribute("href")).toBe("/catalog");
  });
});
