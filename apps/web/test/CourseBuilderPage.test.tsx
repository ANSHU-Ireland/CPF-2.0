import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import type { CourseDetail, OrgUser, TemplateSummary } from "../src/api.js";
import { CourseBuilderPage } from "../src/pages/CourseBuilderPage.js";

const COURSE: CourseDetail = {
  id: "c1",
  title: "Intro to Interviewing",
  description: "A short course.",
  status: "draft",
  published_checksum: null,
  published_at: null,
  modules: [
    {
      id: "m1",
      title: "Module 1",
      position: 0,
      lessons: [{ id: "l1", course_module_id: "m1", title: "Lesson 1", position: 0, practice_template_code: "SE1" }],
    },
  ],
};

const USERS: OrgUser[] = [
  { id: "u1", email: "a@b.com", display_name: "Ada", status: "active", mfa_enrolled: true, roles: ["reviewer"] },
];

const TEMPLATES: TemplateSummary[] = [
  {
    code: "SE1",
    roleFamily: "Engineering",
    title: "Software Engineer I",
    subtitle: "s",
    targetLevel: "L1",
    timebox: "90m",
    frameworkVersion: "1.0",
    criteriaCount: 18,
    criticalCriteriaCount: 3,
  },
];

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((path: string) => {
      if (path.includes("/users")) return Promise.resolve({ status: 200, ok: true, json: async () => USERS });
      if (path.includes("/framework/templates")) return Promise.resolve({ status: 200, ok: true, json: async () => TEMPLATES });
      return Promise.resolve({ status: 200, ok: true, json: async () => COURSE });
    }),
  );
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/org/org-1/learning/admin/courses/c1"]}>
      <Routes>
        <Route path="/org/:orgId/learning/admin/courses/:courseId" element={<CourseBuilderPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("CourseBuilderPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders modules, lessons, and the enrol panel for a draft course", async () => {
    stubFetch();
    renderPage();

    expect(await screen.findByText("Module 1")).toBeTruthy();
    expect(screen.getByText("Lesson 1")).toBeTruthy();
    expect(screen.getByText(/Practice: SE1/)).toBeTruthy();
    expect(screen.getByText("Publish")).toBeTruthy();
    expect(await screen.findByText(/Ada/)).toBeTruthy();
  });
});
