import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import type { CourseSummary } from "../src/api.js";
import { LearningAdminPage } from "../src/pages/LearningAdminPage.js";

function stubFetch(courses: CourseSummary[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve({ status: 200, ok: true, json: async () => courses })),
  );
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/org/org-1/learning/admin"]}>
      <Routes>
        <Route path="/org/:orgId/learning/admin" element={<LearningAdminPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LearningAdminPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the course catalogue", async () => {
    stubFetch([
      { id: "c1", title: "Intro to Interviewing", status: "draft", published_at: null, created_at: "2026-01-01T00:00:00Z" },
    ]);
    renderPage();

    expect(await screen.findByText("Intro to Interviewing")).toBeTruthy();
    expect(screen.getByText("draft")).toBeTruthy();
  });

  it("shows an empty state when there are no courses yet", async () => {
    stubFetch([]);
    renderPage();

    expect(await screen.findByText("No courses yet")).toBeTruthy();
  });
});
