import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import type { EnrollmentDetail } from "../src/api.js";
import { LessonPlayerPage } from "../src/pages/LessonPlayerPage.js";

const DETAIL: EnrollmentDetail = {
  id: "e1",
  status: "in_progress",
  startedAt: "2026-01-01T00:00:00Z",
  completedAt: null,
  course: {
    id: "c1",
    title: "Intro to Interviewing",
    status: "published",
    published_at: "2026-01-01T00:00:00Z",
    modules: [
      {
        id: "m1",
        title: "Module 1",
        position: 0,
        lessons: [
          { id: "l1", course_module_id: "m1", title: "Lesson 1", content_markdown: "# Welcome", position: 0, practice_template_code: null, completed: false },
          { id: "l2", course_module_id: "m1", title: "Lesson 2", content_markdown: "More content", position: 1, practice_template_code: null, completed: false },
        ],
      },
    ],
  },
  pathway: null,
};

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve({ status: 200, ok: true, json: async () => DETAIL })),
  );
}

function renderPage(lessonId: string): void {
  render(
    <MemoryRouter initialEntries={[`/org/org-1/learning/enrollments/e1/lessons/${lessonId}`]}>
      <Routes>
        <Route path="/org/:orgId/learning/enrollments/:enrollmentId/lessons/:lessonId" element={<LessonPlayerPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LessonPlayerPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders lesson content and disables Previous on the first lesson", async () => {
    stubFetch();
    renderPage("l1");

    expect(await screen.findByText("Welcome", { exact: false })).toBeTruthy();
    expect(screen.getByText("Previous")).toHaveProperty("disabled", true);
    expect(screen.getByText("Next")).toHaveProperty("disabled", false);
  });

  it("disables Next on the last lesson and offers to complete the course", async () => {
    stubFetch();
    renderPage("l2");

    expect(await screen.findByText("More content", { exact: false })).toBeTruthy();
    expect(screen.getByText("Next")).toHaveProperty("disabled", true);
    expect(screen.getByText("This is the last lesson.", { exact: false })).toBeTruthy();
  });
});
