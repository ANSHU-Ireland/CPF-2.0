import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import type { AiAdoptionView, SkillsGapView, TokenCostView } from "../src/api.js";
import { InsightsDashboardPage } from "../src/pages/InsightsDashboardPage.js";

function stubFetch(opts: { skillsGap: SkillsGapView; aiAdoption: AiAdoptionView; tokenCost: TokenCostView }): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((path: string) => {
      if (typeof path === "string" && path.includes("skills-gap")) {
        return Promise.resolve({ status: 200, ok: true, json: async () => opts.skillsGap });
      }
      if (typeof path === "string" && path.includes("ai-adoption")) {
        return Promise.resolve({ status: 200, ok: true, json: async () => opts.aiAdoption });
      }
      if (typeof path === "string" && path.includes("token-cost")) {
        return Promise.resolve({ status: 200, ok: true, json: async () => opts.tokenCost });
      }
      return Promise.resolve({ status: 200, ok: true, json: async () => null });
    }),
  );
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/org/org-1/intelligence/insights"]}>
      <Routes>
        <Route path="/org/:orgId/intelligence/insights" element={<InsightsDashboardPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("InsightsDashboardPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders suppressed skills-gap and ai-adoption cells as suppressed, never a fabricated number", async () => {
    stubFetch({
      skillsGap: {
        courses: [
          { courseId: "c1", title: "Tiny Course", suppressed: true, enrolledCount: null, completedCount: null, completionRate: null },
          { courseId: "c2", title: "Big Course", suppressed: false, enrolledCount: 20, completedCount: 10, completionRate: 0.5 },
        ],
        suppressionNote: "note",
      },
      aiAdoption: {
        enrolledCount: null,
        attemptedCount: null,
        participationRate: null,
        definition: "Participation is defined as at least one practice attempt.",
        suppressionNote: "Suppressed until at least 8 learners are enrolled.",
      },
      tokenCost: { available: false, reason: "Token-cost tracking is not available until the AI gateway ships." },
    });
    renderPage();

    expect(await screen.findByText("Tiny Course")).toBeTruthy();
    expect(await screen.findByText("Big Course")).toBeTruthy();
    expect(screen.getByText("20")).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.getAllByText("‹8 — suppressed").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText(/Participation is defined as/)).toBeTruthy();
    expect(screen.getByText(/Token-cost tracking is not available/)).toBeTruthy();
  });
});
