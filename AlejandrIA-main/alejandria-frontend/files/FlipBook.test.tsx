// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FlipBook } from "./FlipBook";

function stubMatchMedia(spread: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("min-width") ? spread : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const pages = ["P1", "P2", "P3", "P4", "P5", "P6"].map((t) => <p key={t}>{t}</p>);
const labels = {
  group: "Libro",
  ribbons: "Hojas",
  prev: "Hoja anterior",
  next: "Hoja siguiente",
  position: (c: number, t: number) => `Hoja ${c} de ${t}`,
};

function setup() {
  return render(<FlipBook pages={pages} ribbons={["Hoy", "Mesa", "Para ti"]} labels={labels} />);
}

afterEach(cleanup);

describe("FlipBook (spread mode)", () => {
  it("shows the first spread and keeps the others out of reach", () => {
    stubMatchMedia(true);
    setup();
    expect(screen.getByText("P1").closest("[inert]")).toBeNull();
    expect(screen.getByText("P2").closest("[inert]")).toBeNull();
    expect(screen.getByText("P3").closest("[inert]")).not.toBeNull();
    expect(screen.getByText("P6").closest("[inert]")).not.toBeNull();
    expect(screen.getByText("Hoja 1 de 3")).toBeTruthy();
  });

  it("turns one spread at a time with the buttons", () => {
    stubMatchMedia(true);
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Hoja siguiente" }));
    expect(screen.getByText("Hoja 2 de 3")).toBeTruthy();
    expect(screen.getByText("P3").closest("[inert]")).toBeNull();
    expect(screen.getByText("P4").closest("[inert]")).toBeNull();
    expect(screen.getByText("P1").closest("[inert]")).not.toBeNull();
    expect((screen.getByRole("button", { name: "Hoja anterior" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("jumps with ribbons and marks the current one", () => {
    stubMatchMedia(true);
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Para ti" }));
    expect(screen.getByRole("button", { name: "Para ti" }).getAttribute("aria-current")).toBe("true");
    expect((screen.getByRole("button", { name: "Hoja siguiente" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("FlipBook (single page mode)", () => {
  it("turns one page at a time", () => {
    stubMatchMedia(false);
    setup();
    expect(screen.getByText("Hoja 1 de 6")).toBeTruthy();
    expect(screen.getByText("P2").closest("[inert]")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Hoja siguiente" }));
    expect(screen.getByText("Hoja 2 de 6")).toBeTruthy();
    expect(screen.getByText("P2").closest("[inert]")).toBeNull();
    expect(screen.getByText("P1").closest("[inert]")).not.toBeNull();
  });
});
