import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import type { ReactElement } from "react";
import { axe } from "vitest-axe";
import type { Result } from "axe-core";
import { AuthProvider } from "../src/auth.js";
import { LoginPage } from "../src/pages/LoginPage.js";
import { CandidateEntryPage } from "../src/pages/CandidateEntryPage.js";
import { CandidatePortalPage } from "../src/pages/CandidatePortalPage.js";
import { TemplatesPage } from "../src/pages/TemplatesPage.js";
import { JobProfilesPage } from "../src/pages/JobProfilesPage.js";
import { SessionsPage } from "../src/pages/SessionsPage.js";
import { TeamPage } from "../src/pages/TeamPage.js";
import { DataRightsPage } from "../src/pages/DataRightsPage.js";
import { ReviewQueuePage } from "../src/pages/ReviewQueuePage.js";
import { ReviewWorkspacePage } from "../src/pages/ReviewWorkspacePage.js";
import { EvidenceProfilePage } from "../src/pages/EvidenceProfilePage.js";

// axe-core's colour-contrast check relies on real computed styles/layout,
// which happy-dom does not render — disabled here to avoid noise unrelated
// to this project's actual CSS (see docs/testing/test-strategy.md).
const AXE_OPTS = { rules: { "color-contrast": { enabled: false } } };

function describeViolations(violations: Result[]): string {
  return violations.map((v) => `${v.id}: ${v.description} (${v.nodes.length} node(s))`).join("\n");
}

async function expectNoViolations(container: Element): Promise<void> {
  const results = await axe(container, AXE_OPTS);
  expect(results.violations, describeViolations(results.violations)).toEqual([]);
}

function stubFetchJson(byUrl: (path: string) => unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((path: string) =>
      Promise.resolve({ status: 200, ok: true, json: async () => byUrl(path) }),
    ),
  );
}

function routerFor(path: string, routePath: string, element: ReactElement): ReactElement {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={element} />
      </Routes>
    </MemoryRouter>
  );
}

describe("accessibility smoke (vitest-axe)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("LoginPage has no axe violations", async () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/login"]}>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>,
    );
    await screen.findByText("Sign in to CPF");
    await expectNoViolations(container);
  });

  it("CandidateEntryPage has no axe violations", async () => {
    const { container } = render(routerFor("/candidate", "/candidate", <CandidateEntryPage />));
    await screen.findByText("Access your assessment");
    await expectNoViolations(container);
  });

  it("CandidatePortalPage (landing) has no axe violations", async () => {
    stubFetchJson(() => ({
      candidateName: "Ada Lovelace",
      invitationStatus: "opened",
      expiresAt: "2026-08-01T00:00:00.000Z",
      assessment: {
        code: "SE1",
        title: "Software Engineer I",
        subtitle: "Practical assessment",
        timebox: "90 minutes",
        purpose: "Assess practical software engineering ability.",
        approvedTools: "Editor, docs.",
        constraints: "No external collaboration.",
        stages: [{ stage: "Brief", durationMinutes: 10, candidateAction: "Read", evidenceCaptured: "n/a" }],
      },
      notices: {
        privacyNotice: "2026-07-25.draft-1",
        aiUseNotice: "2026-07-25.draft-1",
        telemetryNotice: "2026-07-25.draft-1",
        assessmentRules: "2026-07-25.draft-1",
      },
      session: null,
    }));
    const { container } = render(routerFor("/candidate/tok-1", "/candidate/:token", <CandidatePortalPage />));
    await screen.findByText("Software Engineer I");
    await expectNoViolations(container);
  });

  it("TemplatesPage has no axe violations", async () => {
    stubFetchJson(() => [
      { code: "SE1", roleFamily: "Engineering", title: "Software Engineer I", subtitle: "s", targetLevel: "L1", timebox: "90m", frameworkVersion: "1.0", criteriaCount: 18, criticalCriteriaCount: 3 },
    ]);
    const { container } = render(routerFor("/templates", "/templates", <TemplatesPage />));
    await screen.findByText("SE1");
    await expectNoViolations(container);
  });

  it("JobProfilesPage has no axe violations", async () => {
    stubFetchJson(() => []);
    const { container } = render(routerFor("/org/org-1/job-profiles", "/org/:orgId/job-profiles", <JobProfilesPage />));
    await screen.findByText("No job profiles yet");
    await expectNoViolations(container);
  });

  it("SessionsPage has no axe violations", async () => {
    stubFetchJson(() => ({ items: [] }));
    const { container } = render(routerFor("/org/org-1/sessions", "/org/:orgId/sessions", <SessionsPage />));
    await screen.findByText("Refresh");
    await expectNoViolations(container);
  });

  it("TeamPage has no axe violations", async () => {
    stubFetchJson(() => []);
    const { container } = render(routerFor("/org/org-1/team", "/org/:orgId/team", <TeamPage />));
    await screen.findByText("Team");
    await expectNoViolations(container);
  });

  it("DataRightsPage has no axe violations", async () => {
    stubFetchJson(() => []);
    const { container } = render(routerFor("/org/org-1/data-rights", "/org/:orgId/data-rights", <DataRightsPage />));
    await screen.findByText(/Data rights/i);
    await expectNoViolations(container);
  });

  it("ReviewQueuePage has no axe violations", async () => {
    stubFetchJson(() => []);
    const { container } = render(routerFor("/org/org-1/reviews", "/org/:orgId/reviews", <ReviewQueuePage />));
    await screen.findByText("No reviews assigned");
    await expectNoViolations(container);
  });

  it("ReviewWorkspacePage has no axe violations", async () => {
    const template = {
      code: "SE1",
      title: "Software Engineer I",
      reviewerInstruction: "Review carefully.",
      criteria: [
        { id: "SE1-01", dimension: "Craft", weight: 0.1, critical: true, observableStandard: "Standard A", evidenceAndRedFlag: "Evidence A", interviewProbe: "Probe A" },
      ],
    };
    stubFetchJson((path) => {
      if (path.endsWith("/evidence")) return { template, workspaceEvidence: [], integrityContext: { guidance: "Guidance.", signals: [] } };
      if (path.endsWith("/preview"))
        return { overallEvidenceIndex: null, overallBand: null, scoredCoverage: 0, evidenceNoteCoverage: 0, decisionSupportRoute: "insufficient_evidence", adjudicationsRequired: [], criticalConcerns: [], dimensions: [], governanceNote: "Note." };
      if (path.includes("/scoring-model"))
        return { frameworkVersion: "1.0.0", scoreAnchors: [{ score: 1, anchor: "Poor", interpretation: "Poor." }] };
      return { id: "rev-1", session_id: "s-1", status: "assigned", final_rationale: null, confidence: null, limitations: null, scores: [] };
    });
    const { container } = render(routerFor("/org/org-1/reviews/rev-1", "/org/:orgId/reviews/:reviewId", <ReviewWorkspacePage />));
    await screen.findByText("Rubric");
    await expectNoViolations(container);
  });

  it("EvidenceProfilePage has no axe violations", async () => {
    stubFetchJson((path) => {
      if (path.includes("/acknowledgements/responsible-use")) {
        return {
          version: "2026-07-25",
          title: "Responsible use of the Evidence Profile",
          sections: ["No automated hiring or placement outcome."],
          acknowledged: true,
          acknowledgedAt: "2026-07-20T09:00:00.000Z",
        };
      }
      return {
        reviewerSummary: { rationale: "Rationale.", confidence: "high", limitations: "Limitations.", finalisedAt: "2026-07-20T10:00:00.000Z" },
        accommodationsNote: null,
        dimensions: [{ key: "d1", name: "Dimension 1", weight: 0.1, achievementIndex: 3.5, band: "Strong evidence", scoredWeight: 0.1, totalWeight: 0.1 }],
        criticalConcerns: [],
        decisionSupportRoute: "standard_review",
        interviewProbes: [{ criterionId: "SE1-01", probe: "Probe text." }],
        governanceNote: "Governance note.",
      };
    });
    const { container } = render(
      routerFor("/org/org-1/sessions/s-1/profile", "/org/:orgId/sessions/:sessionId/profile", <EvidenceProfilePage />),
    );
    await screen.findByText("Reviewer summary");
    await expectNoViolations(container);
  });

  it("EvidenceProfilePage (responsible-use gate, unacknowledged) has no axe violations", async () => {
    stubFetchJson(() => ({
      version: "2026-07-25",
      title: "Responsible use of the Evidence Profile",
      sections: ["No automated hiring or placement outcome.", "Decision support only."],
      acknowledged: false,
      acknowledgedAt: null,
    }));
    const { container } = render(
      routerFor("/org/org-1/sessions/s-1/profile", "/org/:orgId/sessions/:sessionId/profile", <EvidenceProfilePage />),
    );
    await screen.findByText("Responsible use of the Evidence Profile");
    await expectNoViolations(container);
  });
});
