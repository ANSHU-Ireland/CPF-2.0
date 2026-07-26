import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "../src/auth.js";
import type { PainPointThemesView } from "../src/api.js";
import { PainPointsPage } from "../src/pages/PainPointsPage.js";

const THEMES: PainPointThemesView = {
  themes: [
    { category: "workload", suppressed: false, count: 12 },
    { category: "tooling", suppressed: true, count: null },
    { category: "process", suppressed: true, count: null },
    { category: "management", suppressed: true, count: null },
    { category: "other", suppressed: true, count: null },
  ],
  suppressionNote: "A category's count is shown only once at least 8 reports exist in it.",
};

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve({ status: 201, ok: true, json: async () => ({ id: "pp-1" }) });
      }
      if (typeof path === "string" && path.includes("pain-point-themes")) {
        return Promise.resolve({ status: 200, ok: true, json: async () => THEMES });
      }
      return Promise.resolve({ status: 200, ok: true, json: async () => null });
    }),
  );
}

function seedMembership(role: string): void {
  sessionStorage.setItem("cpf.user", JSON.stringify({ id: "u-1", displayName: "Test User", email: "t@example.com" }));
  sessionStorage.setItem("cpf.memberships", JSON.stringify([{ organisationId: "org-1", role }]));
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/org/org-1/intelligence/pain-points"]}>
      <AuthProvider>
        <Routes>
          <Route path="/org/:orgId/intelligence/pain-points" element={<PainPointsPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("PainPointsPage", () => {
  beforeEach(() => {
    stubFetch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it("lets any org member submit a report, with an anonymous toggle", async () => {
    seedMembership("reviewer");
    renderPage();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Description"), "Too many meetings.");
    await user.click(screen.getByLabelText(/Submit this report anonymously/));
    await user.click(screen.getByRole("button", { name: /Submit report/ }));

    expect(await screen.findByText(/Report submitted/)).toBeTruthy();
    expect(screen.queryByText("Pain-point themes (admin view)")).toBeNull();
  });

  it("shows the admin-only aggregate themes view with suppressed categories rendered as suppressed, not fabricated", async () => {
    seedMembership("org_admin");
    renderPage();

    expect(await screen.findByText("Pain-point themes (admin view)")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getAllByText("‹8 — suppressed").length).toBe(4);
  });
});
