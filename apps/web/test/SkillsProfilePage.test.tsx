import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import type { SkillsProfile } from "../src/api.js";
import { SkillsProfilePage } from "../src/pages/SkillsProfilePage.js";

const PROFILE: SkillsProfile = {
  completedCourses: [{ id: "c1", title: "Intro to Interviewing", completed_at: "2026-01-01T00:00:00Z" }],
  completedPathways: [],
  practiceAttempts: [
    {
      id: "a1",
      template_code: "SE1",
      created_at: "2026-01-02T00:00:00Z",
      profile: {
        overallEvidenceIndex: 0.8,
        overallBand: "Strong evidence",
        scoredCoverage: 1,
        evidenceNoteCoverage: 1,
        decisionSupportRoute: "standard_review",
        adjudicationsRequired: [],
        criticalConcerns: [],
        dimensions: [],
        governanceNote: "Self-scored practice attempt — never a hiring score.",
      },
    },
  ],
};

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve({ status: 200, ok: true, json: async () => PROFILE })),
  );
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/org/org-1/learning/skills-profile"]}>
      <Routes>
        <Route path="/org/:orgId/learning/skills-profile" element={<SkillsProfilePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SkillsProfilePage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders completed courses and practice attempts", async () => {
    stubFetch();
    renderPage();

    expect(await screen.findByText("Intro to Interviewing", { exact: false })).toBeTruthy();
    expect(screen.getByText("SE1")).toBeTruthy();
    expect(screen.getByText("Strong evidence")).toBeTruthy();
  });

  it("shows empty states when nothing has been completed yet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve({
          status: 200,
          ok: true,
          json: async () => ({ completedCourses: [], completedPathways: [], practiceAttempts: [] }),
        }),
      ),
    );
    renderPage();

    expect(await screen.findByText("No completed courses yet")).toBeTruthy();
    expect(screen.getByText("No completed pathways yet")).toBeTruthy();
    expect(screen.getByText("No practice attempts yet")).toBeTruthy();
  });
});
