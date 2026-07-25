import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { EvidenceProfilePage } from "../src/pages/EvidenceProfilePage.js";

function ackFixture(acknowledged: boolean) {
  return {
    version: "2026-07-25",
    title: "Responsible use of the Evidence Profile",
    sections: ["No automated hiring or placement outcome."],
    acknowledged,
    acknowledgedAt: acknowledged ? "2026-07-20T09:00:00.000Z" : null,
  };
}

function profileFixture() {
  const dimensions = Array.from({ length: 10 }, (_, i) => ({
    key: `dim-${i + 1}`,
    name: `Dimension ${i + 1}`,
    weight: 0.1,
    achievementIndex: 3.5,
    band: "strong",
    scoredWeight: 0.1,
    totalWeight: 0.1,
  }));
  const interviewProbes = Array.from({ length: 18 }, (_, i) => ({
    criterionId: `SE1-${String(i + 1).padStart(2, "0")}`,
    probe: `Probe text ${i + 1}`,
  }));
  const collaborationProfile = [
    {
      dimension: "Verification & scepticism",
      band: "Strong",
      claims: [
        {
          claim: "Cross-checked the API response against the documented schema before using it.",
          band: "Strong",
          limitations: null,
          counterEvidence: null,
        },
      ],
    },
    ...Array.from({ length: 6 }, (_, i) => ({
      dimension: `Dimension lens ${i + 1}`,
      band: "Not assessed",
      claims: [] as Array<{ claim: string; band: string; limitations: string | null; counterEvidence: string | null }>,
    })),
  ];
  return {
    reviewerSummary: {
      rationale: "Rationale text covering the overall assessment.",
      confidence: "high",
      limitations: "Limited to a single work sample.",
      finalisedAt: "2026-07-20T10:00:00.000Z",
    },
    accommodationsNote: null,
    dimensions,
    collaborationProfile,
    criticalConcerns: [{ criterionId: "SE1-05", finalScore: 2 }],
    decisionSupportRoute: "standard_review",
    interviewProbes,
    governanceNote: "This profile supports, but does not replace, human judgement.",
  };
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/org/org-1/sessions/s-1/profile"]}>
      <Routes>
        <Route path="/org/:orgId/sessions/:sessionId/profile" element={<EvidenceProfilePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("EvidenceProfilePage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("gates the profile behind a responsible-use acknowledgement, then shows dimension bands, 18 interview probes, and never a hire/reject verdict or numeric score", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((path: string) => {
        if (path.includes("/acknowledgements/responsible-use")) {
          return Promise.resolve({ status: 200, ok: true, json: async () => ackFixture(true) });
        }
        return Promise.resolve({ status: 200, ok: true, json: async () => profileFixture() });
      }),
    );
    renderPage();

    await screen.findByText("Reviewer summary");
    expect(screen.getAllByText("strong").length).toBe(10);

    const details = document.querySelectorAll("details");
    expect(details.length).toBe(18);

    const bodyText = document.body.textContent ?? "";
    expect(/hire/i.test(bodyText)).toBe(false);
    expect(/reject/i.test(bodyText)).toBe(false);
    expect(bodyText.includes("3.5")).toBe(false);
  });

  it("renders the AI Collaboration Profile section with all 7 dimensions above the scoring dimensions, without leaking evidence references", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((path: string) => {
        if (path.includes("/acknowledgements/responsible-use")) {
          return Promise.resolve({ status: 200, ok: true, json: async () => ackFixture(true) });
        }
        return Promise.resolve({ status: 200, ok: true, json: async () => profileFixture() });
      }),
    );
    renderPage();

    await screen.findByText("AI Collaboration Profile");
    expect(screen.getByText("Cross-checked the API response against the documented schema before using it.")).toBeTruthy();
    expect(screen.getAllByText("Not assessed.").length).toBe(6);

    const collabHeadingIndex = Array.from(document.querySelectorAll("h2")).findIndex(
      (el) => el.textContent === "AI Collaboration Profile",
    );
    const dimensionBandsHeadingIndex = Array.from(document.querySelectorAll("h2")).findIndex(
      (el) => el.textContent === "Dimension bands",
    );
    expect(collabHeadingIndex).toBeGreaterThanOrEqual(0);
    expect(dimensionBandsHeadingIndex).toBeGreaterThan(collabHeadingIndex);

    const bodyText = document.body.textContent ?? "";
    expect(bodyText.toLowerCase().includes("evidencereferences")).toBe(false);
    expect(bodyText.toLowerCase().includes("reviewerconfidence")).toBe(false);
  });

  it("shows the responsible-use document and blocks the profile fetch until acknowledged", async () => {
    const fetchMock = vi.fn().mockImplementation((path: string, init?: RequestInit) => {
      if (path.includes("/acknowledgements/responsible-use") && init?.method === "POST") {
        return Promise.resolve({ status: 201, ok: true, json: async () => ackFixture(true) });
      }
      if (path.includes("/acknowledgements/responsible-use")) {
        return Promise.resolve({ status: 200, ok: true, json: async () => ackFixture(false) });
      }
      return Promise.resolve({ status: 200, ok: true, json: async () => profileFixture() });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    await screen.findByText("Responsible use of the Evidence Profile");
    expect(screen.queryByText("Reviewer summary")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "I acknowledge and continue" }));
    const postCall = fetchMock.mock.calls.find((call: unknown[]) => (call[1] as RequestInit | undefined)?.method === "POST");
    expect(postCall).toBeTruthy();
    expect(JSON.parse((postCall![1] as RequestInit).body as string)).toEqual({ version: "2026-07-25" });
  });

  it("shows an explanatory state (not a generic error) for 409 REPORT_NOT_ISSUED", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((path: string) => {
        if (path.includes("/acknowledgements/responsible-use")) {
          return Promise.resolve({ status: 200, ok: true, json: async () => ackFixture(true) });
        }
        return Promise.resolve({
          status: 409,
          ok: false,
          json: async () => ({
            error: { code: "REPORT_NOT_ISSUED", message: "The evidence profile becomes available after the report is issued.", retryable: false },
          }),
        });
      }),
    );
    renderPage();

    await screen.findByText("Evidence profile not yet available");
    expect(screen.queryByText("Could not load this view")).toBeNull();
  });
});
