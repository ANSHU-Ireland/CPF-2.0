import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TemplateDetail, TemplateSummary } from "../src/api.js";
import { TemplatesPage } from "../src/pages/TemplatesPage.js";

function summary(code: string): TemplateSummary {
  return {
    code,
    roleFamily: "software-engineering",
    title: `${code} title`,
    subtitle: "",
    targetLevel: "mid",
    timebox: "90 min",
    frameworkVersion: "1.0.0",
    criteriaCount: 18,
    criticalCriteriaCount: 6,
  };
}

function detail(code: string): TemplateDetail {
  return {
    ...summary(code),
    purpose: "Purpose text",
    simulation: "Simulation text",
    approvedTools: "Editor",
    constraints: "None",
    deliverables: "A report",
    reviewerInstruction: "Review carefully",
    stages: [{ stage: "Brief", durationMinutes: 10, candidateAction: "Read", evidenceCaptured: "n/a" }],
    criteria: Array.from({ length: 18 }, (_, i) => ({
      id: `SE1-${String(i + 1).padStart(2, "0")}`,
      dimension: "Dimension A",
      weight: 1 / 18,
      critical: i < 6,
      observableStandard: "Standard text",
      evidenceAndRedFlag: "Evidence text",
      interviewProbe: "Probe text",
    })),
  };
}

const TEMPLATES = Array.from({ length: 10 }, (_, i) => summary(`T${i}`));

describe("TemplatesPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders all 10 templates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => TEMPLATES }),
    );
    render(<TemplatesPage />);
    await waitFor(() => expect(screen.getAllByText(/View detail/)).toHaveLength(10));
  });

  it("opens the detail drawer and shows all 18 criteria for the selected template", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((path: string) => {
        if (path === "/v1/framework/templates") {
          return Promise.resolve({ status: 200, ok: true, json: async () => TEMPLATES });
        }
        return Promise.resolve({ status: 200, ok: true, json: async () => detail("T0") });
      }),
    );
    render(<TemplatesPage />);
    await waitFor(() => expect(screen.getAllByText(/View detail/)).toHaveLength(10));

    await userEvent.click(screen.getAllByRole("button", { name: "View detail" }).at(0)!);

    const dialog = await screen.findByRole("dialog", { name: /T0/ });
    await waitFor(() => expect(within(dialog).getAllByText(/^SE1-\d{2}$/)).toHaveLength(18));
  });
});
