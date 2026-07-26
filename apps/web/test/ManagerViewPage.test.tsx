import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import type { ManagerView } from "../src/api.js";
import { ManagerViewPage } from "../src/pages/ManagerViewPage.js";

function stubFetch(data: ManagerView): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve({ status: 200, ok: true, json: async () => data })),
  );
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/org/org-1/learning/manager-view"]}>
      <Routes>
        <Route path="/org/:orgId/learning/manager-view" element={<ManagerViewPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ManagerViewPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows a suppressed course as suppressed, not with fabricated counts", async () => {
    stubFetch({
      courses: [
        { courseId: "c1", title: "Small Course", suppressed: true, enrolledCount: null, completedCount: null, completionRate: null },
      ],
      suppressionNote: "A course's completion figures are shown only once at least 5 learners are enrolled in it.",
    });
    renderPage();

    expect(await screen.findByText("Small Course")).toBeTruthy();
    expect(screen.getByText(/Suppressed/)).toBeTruthy();
  });

  it("shows real completion figures once the k-anonymity floor is met", async () => {
    stubFetch({
      courses: [
        { courseId: "c1", title: "Popular Course", suppressed: false, enrolledCount: 10, completedCount: 5, completionRate: 0.5 },
      ],
      suppressionNote: "note",
    });
    renderPage();

    expect(await screen.findByText("Popular Course")).toBeTruthy();
    expect(screen.getByText("10")).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy();
  });
});
