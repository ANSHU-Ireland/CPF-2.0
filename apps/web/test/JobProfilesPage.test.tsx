import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { JobProfilesPage } from "../src/pages/JobProfilesPage.js";

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/org/org-1/job-profiles"]}>
      <Routes>
        <Route path="/org/:orgId/job-profiles" element={<JobProfilesPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("JobProfilesPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the empty state when there are no job profiles", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => [] }));
    renderPage();
    await screen.findByText("No job profiles yet");
  });

  it("creates a job profile via the modal and reloads the table", async () => {
    let created = false;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((path: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          created = true;
          return Promise.resolve({ status: 201, ok: true, json: async () => ({ id: "jp-1" }) });
        }
        return Promise.resolve({
          status: 200,
          ok: true,
          json: async () =>
            created
              ? [{ id: "jp-1", title: "Backend Engineer", role_family: "software-engineering", status: "active", created_at: new Date().toISOString() }]
              : [],
        });
      }),
    );
    renderPage();
    await screen.findByText("No job profiles yet");

    await userEvent.click(screen.getByRole("button", { name: "Add job profile" }));
    await userEvent.type(screen.getByLabelText("Title"), "Backend Engineer");
    await userEvent.click(screen.getByRole("button", { name: "Create job profile" }));

    await waitFor(() => expect(screen.getByText("Backend Engineer")).toBeTruthy());
  });

  it("shows a validation error message when creation fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((path: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          return Promise.resolve({
            status: 400,
            ok: false,
            json: async () => ({ error: { code: "REQUEST_VALIDATION_FAILED", message: "Invalid job profile." } }),
          });
        }
        return Promise.resolve({ status: 200, ok: true, json: async () => [] });
      }),
    );
    renderPage();
    await screen.findByText("No job profiles yet");

    await userEvent.click(screen.getByRole("button", { name: "Add job profile" }));
    await userEvent.type(screen.getByLabelText("Title"), "XX");
    await userEvent.click(screen.getByRole("button", { name: "Create job profile" }));

    await screen.findByText("Invalid job profile.");
  });
});
