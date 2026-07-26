import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import type { RetentionPolicyResponse } from "../src/api.js";
import { CompliancePage } from "../src/pages/CompliancePage.js";

const POLICY: RetentionPolicyResponse = {
  policy: {
    evidence_retention_days: 180,
    integrity_retention_days: 90,
    audit_retention_days: 730,
    deletion_mode: "anonymise_then_delete",
    updated_at: new Date().toISOString(),
  },
  lastRun: null,
  nextDueEstimateNote: "The retention sweep runs on a schedule outside the API.",
};

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((path: string, init?: RequestInit) => {
      if (typeof path === "string" && path.includes("/retention-policy")) {
        if (init?.method === "PUT") {
          return Promise.resolve({ status: 200, ok: true, json: async () => ({ updated: true }) });
        }
        return Promise.resolve({ status: 200, ok: true, json: async () => POLICY });
      }
      if (typeof path === "string" && path.includes("/audit/search")) {
        return Promise.resolve({
          status: 200,
          ok: true,
          json: async () => ({ items: [], total: 0, limit: 25, offset: 0 }),
        });
      }
      if (typeof path === "string" && path.includes("/data-rights")) {
        return Promise.resolve({ status: 200, ok: true, json: async () => [] });
      }
      return Promise.resolve({ status: 200, ok: true, json: async () => ({}) });
    }),
  );
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/org/org-1/compliance"]}>
      <Routes>
        <Route path="/org/:orgId/compliance" element={<CompliancePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("CompliancePage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders all three sections", async () => {
    stubFetch();
    renderPage();

    expect(await screen.findByText("Audit explorer")).toBeTruthy();
    expect(screen.getByText("Retention dashboard")).toBeTruthy();
    expect(screen.getByText("Data rights SLA")).toBeTruthy();
  });

  it("pre-fills the retention policy editor with the current policy", async () => {
    stubFetch();
    renderPage();

    const evidenceInput = (await screen.findByLabelText(/Evidence retention/)) as HTMLInputElement;
    expect(evidenceInput.value).toBe("180");
  });

  it("rejects a zero or negative retention value client-side (no PUT request sent)", async () => {
    stubFetch();
    renderPage();

    const evidenceInput = (await screen.findByLabelText(/Evidence retention/)) as HTMLInputElement;
    await userEvent.clear(evidenceInput);
    await userEvent.type(evidenceInput, "0");
    await userEvent.click(screen.getByRole("button", { name: "Save policy" }));

    expect(await screen.findByText(/must be a whole number between 1 and 3650/)).toBeTruthy();
    expect(
      (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(
        (call: unknown[]) => (call[1] as RequestInit | undefined)?.method === "PUT",
      ),
    ).toBe(false);
  });

  it("rejects a retention value above the 3650-day bound client-side", async () => {
    stubFetch();
    renderPage();

    const auditInput = (await screen.findByLabelText(/Audit retention/)) as HTMLInputElement;
    await userEvent.clear(auditInput);
    await userEvent.type(auditInput, "5000");
    await userEvent.click(screen.getByRole("button", { name: "Save policy" }));

    expect(await screen.findByText(/must be a whole number between 1 and 3650/)).toBeTruthy();
  });

  it("submits a valid retention policy update", async () => {
    stubFetch();
    renderPage();

    const evidenceInput = (await screen.findByLabelText(/Evidence retention/)) as HTMLInputElement;
    await userEvent.clear(evidenceInput);
    await userEvent.type(evidenceInput, "200");
    await userEvent.click(screen.getByRole("button", { name: "Save policy" }));

    await waitFor(() => {
      expect(
        (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(
          (call: unknown[]) => (call[1] as RequestInit | undefined)?.method === "PUT",
        ),
      ).toBe(true);
    });
    expect(await screen.findByText("Retention policy updated.")).toBeTruthy();
  });
});
