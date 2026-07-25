import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import type { SessionRow } from "../src/api.js";
import { SessionsPage } from "../src/pages/SessionsPage.js";

function session(overrides: Partial<SessionRow>): SessionRow {
  return {
    id: "s-1",
    status: "in_progress",
    created_at: new Date().toISOString(),
    started_at: null,
    submitted_at: null,
    has_accommodations: false,
    candidate_id: "c-1",
    candidate_name: "Ada Lovelace",
    candidate_email: "ada@example.com",
    job_title: "Backend Engineer",
    template_code: "SE1",
    review_id: null,
    review_status: null,
    reviewer_user_id: null,
    second_reviewer_user_id: null,
    ...overrides,
  };
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/org/org-1/sessions"]}>
      <Routes>
        <Route path="/org/:orgId/sessions" element={<SessionsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SessionsPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the correct action for each session status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => [
          session({ id: "a", status: "submitted" }),
          session({ id: "b", status: "review_finalised" }),
          session({ id: "c", status: "report_issued" }),
          session({ id: "d", status: "in_progress" }),
        ],
      }),
    );
    renderPage();

    await screen.findByRole("button", { name: "Assign reviewer" });
    expect(screen.getByRole("button", { name: "Issue report" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "View evidence profile" })).toBeTruthy();
  });

  it("surfaces a rejected assignment via an alert, not the console", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((path: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          return Promise.resolve({
            status: 409,
            ok: false,
            json: async () => ({ error: { code: "STATE_CONFLICT", message: "Session is no longer submitted." } }),
          });
        }
        if (typeof path === "string" && path.endsWith("/users")) {
          return Promise.resolve({
            status: 200,
            ok: true,
            json: async () => [{ id: "u-1", email: "rev@example.com", display_name: "Rev Iewer", status: "active", mfa_enrolled: true, roles: ["reviewer"] }],
          });
        }
        return Promise.resolve({ status: 200, ok: true, json: async () => [session({ id: "a", status: "submitted" })] });
      }),
    );
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Assign reviewer" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByLabelText("Reviewer");
    await userEvent.click(within(dialog).getByRole("button", { name: "Assign reviewer" }));

    await waitFor(() => expect(screen.getByText("Session is no longer submitted.")).toBeTruthy());
  });
});
