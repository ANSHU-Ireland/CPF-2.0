import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "../src/auth.js";
import { Shell } from "../src/Shell.js";
import type { OrgModulesView } from "../src/api.js";

const ORG_ID = "org-1";

function seedAuth(): void {
  sessionStorage.setItem(
    "cpf.user",
    JSON.stringify({ id: "u-1", displayName: "Ada Lovelace", email: "ada@example.com" }),
  );
  sessionStorage.setItem(
    "cpf.memberships",
    JSON.stringify([{ organisationId: ORG_ID, role: "org_admin" }]),
  );
}

function renderShell(): void {
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={[`/org/${ORG_ID}/sessions`]}>
        <Routes>
          <Route element={<Shell />}>
            <Route path="/org/:orgId/sessions" element={<div>Sessions page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe("Shell dynamic module nav (Delivery Plan Step 46)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it("renders a registered module's nav entry when the org is entitled to it", async () => {
    seedAuth();
    const modulesView: OrgModulesView = {
      orgId: ORG_ID,
      modules: [
        {
          key: "workflow_insights",
          name: "Workflow Insights",
          version: "0.1.0",
          navigation: [{ label: "Workflow insights", path: "/org/:orgId/workflow-insights" }],
          permissions: ["workflow_insights:read", "workflow_insights:decide"],
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((path: string) => {
        if (typeof path === "string" && path.includes("/modules")) {
          return Promise.resolve({ status: 200, ok: true, json: async () => modulesView });
        }
        return Promise.resolve({ status: 200, ok: true, json: async () => ({ module: "x", enabled: false }) });
      }),
    );
    renderShell();

    expect(await screen.findByRole("link", { name: "Workflow insights" })).toBeTruthy();
  });

  it("does not render a module's nav entry when the org is not entitled to it (empty registry response)", async () => {
    seedAuth();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((path: string) => {
        if (typeof path === "string" && path.includes("/modules")) {
          return Promise.resolve({
            status: 200,
            ok: true,
            json: async () => ({ orgId: ORG_ID, modules: [] }),
          });
        }
        return Promise.resolve({ status: 200, ok: true, json: async () => ({ module: "x", enabled: false }) });
      }),
    );
    renderShell();

    await screen.findByText("Sessions page");
    expect(screen.queryByRole("link", { name: "Workflow insights" })).toBeNull();
  });
});
