import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { AuthProvider } from "../src/auth.js";
import { LoginPage } from "../src/pages/LoginPage.js";

function renderLoginPage() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

function jsonResponse(status: number, body: unknown) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

describe("LoginPage", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders accessible e-mail and password fields with no code visible yet", () => {
    renderLoginPage();
    expect(screen.getByLabelText("E-mail")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.queryByLabelText("Authenticator code")).toBeNull();
  });

  it("reveals the authenticator code field when the server requires MFA", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(401, {
          error: {
            code: "MFA_REQUIRED",
            message: "MFA code required",
            requestId: "r1",
            retryable: false,
          },
        }),
      ),
    );
    renderLoginPage();
    await userEvent.type(screen.getByLabelText("E-mail"), "founder@cpf.local");
    await userEvent.type(screen.getByLabelText("Password"), "correct-horse-battery-staple");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(screen.getByLabelText("Authenticator code")).toBeTruthy());
    expect(
      screen.getByText("Enter the 6-digit code from your authenticator app."),
    ).toBeTruthy();
  });

  it("shows a lockout message distinct from invalid-credential messaging", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(423, {
          error: { code: "ACCOUNT_LOCKED", message: "locked", requestId: "r2", retryable: false },
        }),
      ),
    );
    renderLoginPage();
    await userEvent.type(screen.getByLabelText("E-mail"), "founder@cpf.local");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() =>
      expect(
        screen.getByText(/Too many failed attempts\. The account is temporarily locked/),
      ).toBeTruthy(),
    );
    expect(screen.queryByLabelText("Authenticator code")).toBeNull();
  });
});
