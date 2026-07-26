import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import type { PlatformAnalytics } from "../src/api.js";
import { PlatformAnalyticsPage } from "../src/pages/PlatformAnalyticsPage.js";

const ANALYTICS: PlatformAnalytics = {
  totalAssessmentsByStatus: [{ status: "report_issued", count: 12 }],
  byTemplate: [
    { templateCode: "SE3", suppressed: false, sessionCount: 6, medianReviewerMinutes: 30 },
    { templateCode: "DM2", suppressed: true, sessionCount: null, medianReviewerMinutes: null },
  ],
  suppressionNote:
    "Per-template figures are shown only once at least 5 distinct organisations have used that template, to prevent inferring any single organisation's data.",
};

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve({ status: 200, ok: true, json: async () => ANALYTICS })),
  );
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/platform/analytics"]}>
      <Routes>
        <Route path="/platform/analytics" element={<PlatformAnalyticsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PlatformAnalyticsPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the non-suppressed template's real figures", async () => {
    stubFetch();
    renderPage();

    expect(await screen.findByText("SE3")).toBeTruthy();
    expect(screen.getByText("6")).toBeTruthy();
    expect(screen.getByText("30")).toBeTruthy();
  });

  it("never reveals a suppressed template's session count or reviewer minutes", async () => {
    stubFetch();
    renderPage();

    expect(await screen.findByText("DM2")).toBeTruthy();
    expect(screen.getAllByText("suppressed").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("< 5 organisations")).toBeTruthy();
  });
});
