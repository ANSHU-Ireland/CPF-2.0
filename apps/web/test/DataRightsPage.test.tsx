import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import type { DataRightsRow, LegalHoldRow } from "../src/api.js";
import { DataRightsPage } from "../src/pages/DataRightsPage.js";

function request(overrides: Partial<DataRightsRow>): DataRightsRow {
  return {
    id: "dsr-1",
    candidate_id: "c-1",
    candidate_name: "Ada Lovelace",
    candidate_email: "ada@example.com",
    request_type: "erasure",
    status: "received",
    received_at: new Date().toISOString(),
    due_at: new Date(Date.now() + 86_400_000).toISOString(),
    resolved_at: null,
    overdue: false,
    ...overrides,
  };
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/org/org-1/data-rights"]}>
      <Routes>
        <Route path="/org/:orgId/data-rights" element={<DataRightsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("DataRightsPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows only the allowed transition buttons for a request's status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((path: string) => {
        if (typeof path === "string" && path.includes("/legal-holds")) {
          return Promise.resolve({ status: 200, ok: true, json: async () => [] });
        }
        return Promise.resolve({ status: 200, ok: true, json: async () => [request({ status: "in_progress" })] });
      }),
    );
    renderPage();

    await screen.findByText("Ada Lovelace");
    expect(screen.getByRole("button", { name: "Refer to controller" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fulfil" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refuse (with grounds)" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Verify identity" })).toBeNull();
  });

  it("shows legal-hold guidance instead of a generic error when fulfilment is blocked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((path: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          return Promise.resolve({
            status: 409,
            ok: false,
            json: async () => ({ error: { code: "LEGAL_HOLD_ACTIVE", message: "An active legal hold prevents erasure." } }),
          });
        }
        if (typeof path === "string" && path.includes("/legal-holds")) {
          return Promise.resolve({ status: 200, ok: true, json: async () => [] });
        }
        return Promise.resolve({ status: 200, ok: true, json: async () => [request({ status: "in_progress" })] });
      }),
    );
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Fulfil" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(screen.getByText(/An active legal hold prevents erasure for this candidate/)).toBeTruthy(),
    );
  });

  it("renders active and released legal holds with a release action", async () => {
    const holdsData: LegalHoldRow[] = [
      {
        id: "h-1",
        candidate_id: "c-1",
        candidate_name: "Ada Lovelace",
        candidate_email: "ada@example.com",
        reason: "Ongoing litigation",
        placed_at: new Date().toISOString(),
        released_at: null,
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((path: string) => {
        if (typeof path === "string" && path.includes("/legal-holds")) {
          return Promise.resolve({ status: 200, ok: true, json: async () => holdsData });
        }
        return Promise.resolve({ status: 200, ok: true, json: async () => [] });
      }),
    );
    renderPage();

    await screen.findByText("Ongoing litigation");
    expect(screen.getByRole("button", { name: "Release" })).toBeTruthy();
  });
});
