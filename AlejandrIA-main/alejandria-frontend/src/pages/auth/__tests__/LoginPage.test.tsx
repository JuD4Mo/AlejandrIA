import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "../LoginPage";

const auth = {
  login: vi.fn(),
  flash: null as string | null,
  clearFlash: vi.fn(),
};

vi.mock("@/auth/AuthProvider", () => ({
  useAuth: () => auth,
}));

describe("LoginPage", () => {
  beforeEach(() => {
    auth.login.mockReset();
    auth.flash = null;
  });

  function renderPage() {
    return render(<MemoryRouter><LoginPage /></MemoryRouter>);
  }

  it("keeps the accessible login surface", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Entrar a la sala" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Correo electrónico" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Tu contraseña")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Entrar" })).toBeInTheDocument();
  });

  it("shows a flash status note", () => {
    auth.flash = "Tu sesión expiró.";
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("Tu sesión expiró.");
  });

  it("moves the scene to error after a failed login", async () => {
    auth.login.mockRejectedValue(new Error("falló"));
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByRole("textbox", { name: "Correo electrónico" }), "persona@correo.com");
    await user.type(screen.getByPlaceholderText("Tu contraseña"), "una contraseña suficientemente larga");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(document.querySelector(".auth-scene")).toHaveAttribute("data-mode", "error");
  });
});
