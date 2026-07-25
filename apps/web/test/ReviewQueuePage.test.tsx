import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { ReviewQueuePage } from "../src/pages/ReviewQueuePage.js";

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/org/org-1/reviews"]}>
      <Routes>
        <Route path="/org/:orgId/reviews" element={<ReviewQueuePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ReviewQueuePage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the empty state when no reviews are assigned", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => [] }));
    renderPage();
    await screen.findByText("No reviews assigned");
  });

  it("renders a row that links to the review workspace", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => [
          { id: "rev-1", status: "assigned", created_at: new Date().toISOString(), session_id: "s-1", submitted_at: null },
        ],
      }),
    );
    renderPage();
    const link = await screen.findByRole("link", { name: "Open workspace" });
    expect(link.getAttribute("href")).toBe("/org/org-1/reviews/rev-1");
  });
});
