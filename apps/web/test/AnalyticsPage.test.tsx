import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import type { OrgAnalytics } from "../src/api.js";
import { AnalyticsPage } from "../src/pages/AnalyticsPage.js";

const ANALYTICS: OrgAnalytics = {
  assessmentsByStatus: [
    { status: "report_issued", count: 3 },
    { status: "in_progress", count: 1 },
  ],
  byTemplate: [{ templateCode: "SE1", sessionCount: 3, medianReviewerMinutes: 42.5 }],
  completionRate: {
    startedCount: 4,
    completedCount: 3,
    rate: 0.75,
    definition: "completed (report_issued) / started (has a started_at), among this org's own sessions.",
  },
  challengeRate: {
    reportedCount: 3,
    challengedCount: 1,
    rate: 1 / 3,
    definition: "distinct candidates with a data-rights 'challenge' request / distinct candidates with at least one report_issued session.",
  },
};

function stubFetch(data: OrgAnalytics = ANALYTICS): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve({ status: 200, ok: true, json: async () => data })),
  );
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/org/org-1/analytics"]}>
      <Routes>
        <Route path="/org/:orgId/analytics" element={<AnalyticsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AnalyticsPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders assessment status counts, template reviewer-minutes, and rates with definitions", async () => {
    stubFetch();
    renderPage();

    expect(await screen.findByText("report_issued")).toBeTruthy();
    expect(screen.getByText("SE1")).toBeTruthy();
    expect(screen.getByText("42.5")).toBeTruthy();
    expect(screen.getByText("75%")).toBeTruthy();
    expect(screen.getByText(/completed \(report_issued\)/)).toBeTruthy();
  });

  it("shows empty states instead of fabricated data when there is no activity", async () => {
    stubFetch({
      assessmentsByStatus: [],
      byTemplate: [],
      completionRate: { startedCount: 0, completedCount: 0, rate: null, definition: ANALYTICS.completionRate.definition },
      challengeRate: { reportedCount: 0, challengedCount: 0, rate: null, definition: ANALYTICS.challengeRate.definition },
    });
    renderPage();

    expect(await screen.findByText("No assessment sessions yet")).toBeTruthy();
    expect(screen.getByText("No template activity yet")).toBeTruthy();
    expect(screen.getAllByText("n/a").length).toBe(2);
  });
});
