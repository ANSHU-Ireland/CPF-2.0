import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import type { WorkflowInsightProposal, WorkflowInsightProposalsView } from "../src/api.js";
import { WorkflowInsightsPage } from "../src/pages/WorkflowInsightsPage.js";

function proposal(overrides: Partial<WorkflowInsightProposal>): WorkflowInsightProposal {
  return {
    id: "p-1",
    sourceType: "pain_point_theme",
    sourceKey: "pain_point_theme:workload",
    title: 'Address recurring "workload" pain points',
    rationale: "8 employees reported this.",
    status: "proposed",
    decidedByUserId: null,
    decidedAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/org/org-1/workflow-insights"]}>
      <Routes>
        <Route path="/org/:orgId/workflow-insights" element={<WorkflowInsightsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("WorkflowInsightsPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders open proposals with approve/dismiss actions, and no proposal is ever auto-executed", async () => {
    const view: WorkflowInsightProposalsView = { proposals: [proposal({})] };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve({ status: 200, ok: true, json: async () => view })),
    );
    renderPage();

    expect(await screen.findByText('Address recurring "workload" pain points')).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
    // No other action verb (e.g. "Execute", "Apply", "Run") appears anywhere.
    expect(screen.queryByRole("button", { name: /execute|apply|run/i })).toBeNull();
  });

  it("approving a proposal calls the approve endpoint and reloads the list", async () => {
    const openView: WorkflowInsightProposalsView = { proposals: [proposal({})] };
    const decidedView: WorkflowInsightProposalsView = {
      proposals: [proposal({ status: "approved", decidedAt: new Date().toISOString() })],
    };
    let approveCalled = false;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((path: string, init?: RequestInit) => {
        if (init?.method === "POST" && typeof path === "string" && path.includes("/approve")) {
          approveCalled = true;
          return Promise.resolve({ status: 200, ok: true, json: async () => ({ id: "p-1", status: "approved" }) });
        }
        return Promise.resolve({
          status: 200,
          ok: true,
          json: async () => (approveCalled ? decidedView : openView),
        });
      }),
    );
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Approve" }));

    await waitFor(() => expect(approveCalled).toBe(true));
    await waitFor(() => expect(screen.getByText("Approved")).toBeTruthy());
  });

  it("clicking Generate proposals calls the generate endpoint", async () => {
    let generateCalled = false;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((path: string, init?: RequestInit) => {
        if (init?.method === "POST" && typeof path === "string" && path.includes("/generate")) {
          generateCalled = true;
          return Promise.resolve({ status: 201, ok: true, json: async () => ({ createdCount: 0, createdIds: [] }) });
        }
        return Promise.resolve({ status: 200, ok: true, json: async () => ({ proposals: [] }) });
      }),
    );
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Generate proposals" }));
    await waitFor(() => expect(generateCalled).toBe(true));
  });
});
