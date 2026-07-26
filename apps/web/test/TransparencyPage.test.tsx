import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { COLLECTED_SIGNALS, FORBIDDEN_SIGNALS, TransparencyPage } from "../src/pages/TransparencyPage.js";

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() =>
      Promise.resolve({ status: 200, ok: true, json: async () => ({ module: "intelligence", enabled: true }) }),
    ),
  );
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/org/org-1/intelligence/transparency"]}>
      <Routes>
        <Route path="/org/:orgId/intelligence/transparency" element={<TransparencyPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("TransparencyPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("lists every forbidden signal verbatim from the shared constants list", async () => {
    stubFetch();
    renderPage();

    await screen.findByText(/currently/);
    expect(FORBIDDEN_SIGNALS.length).toBeGreaterThan(0);
    for (const signal of FORBIDDEN_SIGNALS) {
      expect(screen.getByText(signal)).toBeTruthy();
    }
  });

  it("lists every collected signal verbatim from the shared constants list", async () => {
    stubFetch();
    renderPage();

    await screen.findByText(/currently/);
    expect(COLLECTED_SIGNALS.length).toBeGreaterThan(0);
    for (const signal of COLLECTED_SIGNALS) {
      expect(screen.getByText(signal)).toBeTruthy();
    }
  });
});
