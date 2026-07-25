import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { ReviewWorkspacePage } from "../src/pages/ReviewWorkspacePage.js";

const TEMPLATE = {
  code: "SE1",
  title: "Software Engineer I",
  reviewerInstruction: "Review carefully.",
  criteria: [
    { id: "SE1-01", dimension: "Craft", weight: 0.1, critical: true, observableStandard: "Standard A", evidenceAndRedFlag: "Evidence A", interviewProbe: "Probe A" },
    { id: "SE1-02", dimension: "Craft", weight: 0.1, critical: false, observableStandard: "Standard B", evidenceAndRedFlag: "Evidence B", interviewProbe: "Probe B" },
  ],
};

const SCORING_MODEL = {
  frameworkVersion: "1.0.0",
  scoreAnchors: [
    { score: 1, anchor: "Poor", interpretation: "Poor interpretation" },
    { score: 2, anchor: "Weak", interpretation: "Weak interpretation" },
    { score: 3, anchor: "Adequate", interpretation: "Adequate interpretation" },
    { score: 4, anchor: "Strong", interpretation: "Strong interpretation" },
    { score: 5, anchor: "Excellent", interpretation: "Excellent interpretation" },
  ],
};

function detailResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: "rev-1",
    session_id: "s-1",
    status: "assigned",
    final_rationale: null,
    confidence: null,
    limitations: null,
    scores: [],
    ...overrides,
  };
}

function evidenceResponse(overrides: Record<string, unknown> = {}) {
  return {
    template: TEMPLATE,
    workspaceEvidence: [],
    integrityContext: { guidance: "Integrity guidance text.", signals: [] },
    ...overrides,
  };
}

function previewResponse(overrides: Record<string, unknown> = {}) {
  return {
    overallEvidenceIndex: null,
    overallBand: null,
    scoredCoverage: 0,
    evidenceNoteCoverage: 0,
    decisionSupportRoute: "insufficient_evidence",
    adjudicationsRequired: [],
    criticalConcerns: [],
    dimensions: [],
    governanceNote: "Governance note.",
    ...overrides,
  };
}

function stubFetch(opts: {
  detail?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
  preview?: Record<string, unknown>;
  onPut?: () => Promise<unknown> | unknown;
  onPost?: (path: string) => Promise<unknown> | unknown;
}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const result = opts.onPut ? opts.onPut() : { status: 200, ok: true, json: async () => ({ saved: 0 }) };
        return Promise.resolve(result);
      }
      if (init?.method === "POST") {
        const result = opts.onPost ? opts.onPost(path) : { status: 200, ok: true, json: async () => ({ finalised: true }) };
        return Promise.resolve(result);
      }
      if (typeof path === "string" && path.endsWith("/evidence")) {
        return Promise.resolve({ status: 200, ok: true, json: async () => evidenceResponse(opts.evidence) });
      }
      if (typeof path === "string" && path.endsWith("/preview")) {
        return Promise.resolve({ status: 200, ok: true, json: async () => previewResponse(opts.preview) });
      }
      if (typeof path === "string" && path.includes("/scoring-model")) {
        return Promise.resolve({ status: 200, ok: true, json: async () => SCORING_MODEL });
      }
      return Promise.resolve({ status: 200, ok: true, json: async () => detailResponse(opts.detail) });
    }),
  );
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/org/org-1/reviews/rev-1"]}>
      <Routes>
        <Route path="/org/:orgId/reviews/:reviewId" element={<ReviewWorkspacePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ReviewWorkspacePage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("selects a rubric anchor via keyboard and marks the page dirty", async () => {
    stubFetch({});
    renderPage();

    await screen.findByText("SE1-01", { exact: false });
    const group = screen.getByRole("radiogroup", { name: "Score for SE1-01" });
    const anchorRadio = within(group).getByRole("radio", { name: /1 — Poor/ });
    await userEvent.click(anchorRadio);
    expect((anchorRadio as HTMLInputElement).checked).toBe(true);
    await screen.findByText("Unsaved changes");
  });

  it("shows the adjudication banner when the preview reports required adjudications", async () => {
    stubFetch({ preview: { adjudicationsRequired: ["SE1-01"] } });
    renderPage();
    await screen.findByText(/Reviewer variance requires adjudication for: SE1-01/);
  });

  it("keeps Finalise disabled until rationale/confidence/limitations are all valid", async () => {
    stubFetch({});
    renderPage();
    await screen.findByText("SE1-01", { exact: false });

    await userEvent.click(screen.getByRole("button", { name: "Finalise" }));
    const dialog = await screen.findByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: "Finalise review" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    await userEvent.type(within(dialog).getByLabelText("Rationale"), "This rationale is at least twenty characters long.");
    await userEvent.selectOptions(within(dialog).getByLabelText("Confidence"), "high");
    await userEvent.type(within(dialog).getByLabelText("Limitations"), "Some limitations noted.");

    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("surfaces a 409 finalised-state error via Alert when saving scores", async () => {
    stubFetch({
      detail: { status: "assigned" },
      onPut: () => ({
        status: 409,
        ok: false,
        json: async () => ({ error: { code: "STATE_CONFLICT", message: "A finalised review is immutable. Reopen it to make changes." } }),
      }),
    });
    renderPage();
    await screen.findByText("SE1-01", { exact: false });

    await userEvent.click(screen.getByRole("button", { name: "Save scores" }));
    await waitFor(() => expect(screen.getByText("A finalised review is immutable. Reopen it to make changes.")).toBeTruthy());
  });
});
