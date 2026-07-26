import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import type { PathwaySummary } from "../src/api.js";
import { PathwaysPage } from "../src/pages/PathwaysPage.js";

function stubFetch(pathways: PathwaySummary[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve({ status: 200, ok: true, json: async () => pathways })),
  );
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/org/org-1/learning/pathways"]}>
      <Routes>
        <Route path="/org/:orgId/learning/pathways" element={<PathwaysPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PathwaysPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the pathway list", async () => {
    stubFetch([{ id: "p1", title: "New Manager Pathway", status: "draft", created_at: "2026-01-01T00:00:00Z" }]);
    renderPage();

    expect(await screen.findByText("New Manager Pathway")).toBeTruthy();
  });

  it("shows an empty state when there are no pathways yet", async () => {
    stubFetch([]);
    renderPage();

    expect(await screen.findByText("No pathways yet")).toBeTruthy();
  });
});
