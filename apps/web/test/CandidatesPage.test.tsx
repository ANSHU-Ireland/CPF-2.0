import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { CandidatesPage } from "../src/pages/CandidatesPage.js";

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/org/org-1/candidates"]}>
      <Routes>
        <Route path="/org/:orgId/candidates" element={<CandidatesPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("CandidatesPage — CSV import (CPF-35)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("uploads a CSV and renders the created/duplicate/invalid report", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((path: string, init?: RequestInit) => {
        if (init?.method === "POST" && path.includes("/candidates/import")) {
          return Promise.resolve({
            status: 201,
            ok: true,
            json: async () => ({
              created: 2,
              skippedDuplicates: [{ line: 3, email: "dupe@candidate.test" }],
              invalid: [{ line: 4, reason: "E-mail address is invalid." }],
            }),
          });
        }
        return Promise.resolve({ status: 200, ok: true, json: async () => ({ items: [], nextCursor: null }) });
      }),
    );
    renderPage();
    await screen.findByText("No candidates yet");

    await userEvent.click(screen.getByRole("button", { name: "Import CSV" }));
    const file = new File(["name,email\nAda,ada@candidate.test\n"], "candidates.csv", { type: "text/csv" });
    const input = screen.getByLabelText("CSV file") as HTMLInputElement;
    await userEvent.upload(input, file);

    await userEvent.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() =>
      expect(screen.getByText(/Imported 2 candidates\. 1 duplicate skipped, 1 invalid row\./)).toBeTruthy(),
    );
    expect(screen.getByRole("button", { name: "Download rejected rows (CSV)" })).toBeTruthy();
  });

  it("shows an error message when the import request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((path: string, init?: RequestInit) => {
        if (init?.method === "POST" && path.includes("/candidates/import")) {
          return Promise.resolve({
            status: 413,
            ok: false,
            json: async () => ({
              error: { code: "IMPORT_TOO_LARGE", message: "The import contains too many rows.", requestId: "r1", retryable: false },
            }),
          });
        }
        return Promise.resolve({ status: 200, ok: true, json: async () => ({ items: [], nextCursor: null }) });
      }),
    );
    renderPage();
    await screen.findByText("No candidates yet");

    await userEvent.click(screen.getByRole("button", { name: "Import CSV" }));
    const file = new File(["name,email\n"], "candidates.csv", { type: "text/csv" });
    const input = screen.getByLabelText("CSV file") as HTMLInputElement;
    await userEvent.upload(input, file);
    await userEvent.click(screen.getByRole("button", { name: "Import" }));

    await screen.findByText("The import contains too many rows.");
  });
});
