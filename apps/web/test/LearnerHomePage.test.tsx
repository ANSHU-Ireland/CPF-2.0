import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import type { EnrollmentSummary } from "../src/api.js";
import { LearnerHomePage } from "../src/pages/LearnerHomePage.js";

function stubFetch(enrollments: EnrollmentSummary[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve({ status: 200, ok: true, json: async () => enrollments })),
  );
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/org/org-1/learning"]}>
      <Routes>
        <Route path="/org/:orgId/learning" element={<LearnerHomePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LearnerHomePage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders my enrolments with type and status", async () => {
    stubFetch([
      {
        id: "e1",
        status: "in_progress",
        course_id: "c1",
        pathway_id: null,
        started_at: "2026-01-01T00:00:00Z",
        completed_at: null,
        title: "Intro to Interviewing",
      },
    ]);
    renderPage();

    expect(await screen.findByText("Intro to Interviewing")).toBeTruthy();
    expect(screen.getByText("Course")).toBeTruthy();
    expect(screen.getByText("in progress")).toBeTruthy();
    expect(screen.getByText("Continue")).toBeTruthy();
  });

  it("shows an empty state when there are no enrolments yet", async () => {
    stubFetch([]);
    renderPage();

    expect(await screen.findByText("No enrolments yet")).toBeTruthy();
  });
});
