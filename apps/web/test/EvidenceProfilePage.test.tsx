import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { EvidenceProfilePage } from "../src/pages/EvidenceProfilePage.js";

function profileFixture() {
  const dimensions = Array.from({ length: 10 }, (_, i) => ({
    key: `dim-${i + 1}`,
    name: `Dimension ${i + 1}`,
    weight: 0.1,
    achievementIndex: 3.5,
    band: "strong",
    scoredWeight: 0.1,
    totalWeight: 0.1,
  }));
  const interviewProbes = Array.from({ length: 18 }, (_, i) => ({
    criterionId: `SE1-${String(i + 1).padStart(2, "0")}`,
    probe: `Probe text ${i + 1}`,
  }));
  return {
    reviewerSummary: {
      rationale: "Rationale text covering the overall assessment.",
      confidence: "high",
      limitations: "Limited to a single work sample.",
      finalisedAt: "2026-07-20T10:00:00.000Z",
    },
    accommodationsNote: null,
    dimensions,
    criticalConcerns: [{ criterionId: "SE1-05", finalScore: 2 }],
    decisionSupportRoute: "standard_review",
    interviewProbes,
    governanceNote: "This profile supports, but does not replace, human judgement.",
  };
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/org/org-1/sessions/s-1/profile"]}>
      <Routes>
        <Route path="/org/:orgId/sessions/:sessionId/profile" element={<EvidenceProfilePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("EvidenceProfilePage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders dimension bands, 18 interview probes, and never a hire/reject verdict or numeric score", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => profileFixture() }),
    );
    renderPage();

    await screen.findByText("Reviewer summary");
    expect(screen.getAllByText("strong").length).toBe(10);

    const details = document.querySelectorAll("details");
    expect(details.length).toBe(18);

    const bodyText = document.body.textContent ?? "";
    expect(/hire/i.test(bodyText)).toBe(false);
    expect(/reject/i.test(bodyText)).toBe(false);
    expect(bodyText.includes("3.5")).toBe(false);
  });

  it("shows an explanatory state (not a generic error) for 409 REPORT_NOT_ISSUED", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 409,
        ok: false,
        json: async () => ({
          error: { code: "REPORT_NOT_ISSUED", message: "The evidence profile becomes available after the report is issued.", retryable: false },
        }),
      }),
    );
    renderPage();

    await screen.findByText("Evidence profile not yet available");
    expect(screen.queryByText("Could not load this view")).toBeNull();
  });
});
