import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { TeamPage } from "../src/pages/TeamPage.js";

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/org/org-1/team"]}>
      <Routes>
        <Route path="/org/:orgId/team" element={<TeamPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("TeamPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("invites a member and displays the one-time activation token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((path: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          return Promise.resolve({
            status: 201,
            ok: true,
            json: async () => ({ userId: "u-2", activationToken: "abc123", note: "shown once" }),
          });
        }
        return Promise.resolve({ status: 200, ok: true, json: async () => [] });
      }),
    );
    renderPage();
    await screen.findByText("No team members yet");

    await userEvent.click(screen.getByRole("button", { name: "Invite member" }));
    await userEvent.type(screen.getByLabelText("E-mail"), "new@example.com");
    await userEvent.type(screen.getByLabelText("Name"), "New Person");
    await userEvent.click(screen.getByRole("button", { name: "Send invitation" }));

    await screen.findByText("abc123");

    // Attempting to close must warn, since the token cannot be retrieved again.
    const confirmMock = vi.fn().mockReturnValue(false);
    vi.stubGlobal("confirm", confirmMock);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(confirmMock).toHaveBeenCalled();
    expect(screen.getByText("abc123")).toBeTruthy();
  });

  it("renders a permission-denied state for non-admin users (403)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 403,
        ok: false,
        json: async () => ({ error: { code: "FORBIDDEN", message: "Admins only.", requestId: "r-1", retryable: false } }),
      }),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText("You do not have access to this")).toBeTruthy());
  });
});
