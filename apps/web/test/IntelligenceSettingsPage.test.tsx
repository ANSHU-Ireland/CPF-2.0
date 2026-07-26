import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import type { IntelligenceSettings } from "../src/api.js";
import { IntelligenceSettingsPage } from "../src/pages/IntelligenceSettingsPage.js";

function stubFetch(opts: { settings: IntelligenceSettings; onPut?: (body: unknown) => Record<string, unknown> }): void {
  let current = opts.settings;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        if (opts.onPut) {
          const result = opts.onPut(body);
          if (result.status && result.status !== 200) {
            return Promise.resolve({
              status: result.status,
              ok: false,
              json: async () => ({ error: result.error ?? { code: "ERR", message: "error" } }),
            });
          }
        }
        current = {
          enabled: body.enabled === true,
          worksCouncilAcknowledgedBy: (body.worksCouncilAcknowledgedBy as string) ?? null,
          worksCouncilAcknowledgedAt: body.enabled === true ? new Date().toISOString() : null,
          enabledAt: body.enabled === true ? new Date().toISOString() : null,
        };
        return Promise.resolve({ status: 200, ok: true, json: async () => ({ saved: true }) });
      }
      return Promise.resolve({ status: 200, ok: true, json: async () => current });
    }),
  );
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/org/org-1/intelligence/settings"]}>
      <Routes>
        <Route path="/org/:orgId/intelligence/settings" element={<IntelligenceSettingsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("IntelligenceSettingsPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows not-enabled status and requires both a name and the confirmation checkbox before enabling", async () => {
    stubFetch({
      settings: { enabled: false, worksCouncilAcknowledgedBy: null, worksCouncilAcknowledgedAt: null, enabledAt: null },
    });
    renderPage();

    expect(await screen.findByText(/not enabled/)).toBeTruthy();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Enable Workforce Intelligence/ }));
    expect(await screen.findByText(/Enter the name of the works council/)).toBeTruthy();
  });

  it("enables successfully once name and confirmation are provided", async () => {
    stubFetch({
      settings: { enabled: false, worksCouncilAcknowledgedBy: null, worksCouncilAcknowledgedAt: null, enabledAt: null },
    });
    renderPage();

    await screen.findByText(/not enabled/);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Works council/), "Jane Rep");
    await user.click(screen.getByLabelText(/I confirm the works-council pack/));
    await user.click(screen.getByRole("button", { name: /Enable Workforce Intelligence/ }));

    await waitFor(() => expect(screen.getByText(/enabled\./)).toBeTruthy());
  });
});
