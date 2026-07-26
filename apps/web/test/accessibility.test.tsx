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
import { AnalyticsPage } from "../src/pages/AnalyticsPage.js";
import { CandidatesPage } from "../src/pages/CandidatesPage.js";
import { CompliancePage } from "../src/pages/CompliancePage.js";
import { CourseBuilderPage } from "../src/pages/CourseBuilderPage.js";
import { InsightsDashboardPage } from "../src/pages/InsightsDashboardPage.js";
import { IntelligenceSettingsPage } from "../src/pages/IntelligenceSettingsPage.js";
import { LearnerHomePage } from "../src/pages/LearnerHomePage.js";
import { LearningAdminPage } from "../src/pages/LearningAdminPage.js";
import { LessonPlayerPage } from "../src/pages/LessonPlayerPage.js";
import { ManagerViewPage } from "../src/pages/ManagerViewPage.js";
import { PainPointsPage } from "../src/pages/PainPointsPage.js";
import { PathwaysPage } from "../src/pages/PathwaysPage.js";
import { PlatformAnalyticsPage } from "../src/pages/PlatformAnalyticsPage.js";
import { PlatformOrgsPage } from "../src/pages/PlatformOrgsPage.js";
import { SkillsProfilePage } from "../src/pages/SkillsProfilePage.js";
import { TransparencyPage } from "../src/pages/TransparencyPage.js";
import { WorkflowInsightsPage } from "../src/pages/WorkflowInsightsPage.js";
import type {
  AiAdoptionView,
  CourseDetail,
  EnrollmentDetail,
  ManagerView,
  OrgAnalytics,
  PainPointThemesView,
  PlatformAnalytics,
  SkillsGapView,
  SkillsProfile,
  TokenCostView,
  WorkflowInsightProposalsView,
} from "../src/api.js";

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
    stubFetchJson((path) =>
      path.includes("/usage")
        ? { plan: null, usage: { activeAssessments: { used: 0, limit: null }, orgUsers: { used: 0, limit: null } } }
        : [],
    );
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
      return { id: "rev-1", session_id: "s-1", reviewer_user_id: "u-reviewer-1", second_reviewer_user_id: null, status: "assigned", final_rationale: null, confidence: null, limitations: null, scores: [] };
    });
    const { container } = render(
      <MemoryRouter initialEntries={["/org/org-1/reviews/rev-1"]}>
        <AuthProvider>
          <Routes>
            <Route path="/org/:orgId/reviews/:reviewId" element={<ReviewWorkspacePage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
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
        collaborationProfile: [
          { dimension: "Verification & scepticism", band: "Strong", claims: [{ claim: "Claim text.", band: "Strong", limitations: null, counterEvidence: null }] },
          { dimension: "Problem framing", band: "Not assessed", claims: [] },
        ],
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

  it("AnalyticsPage has no axe violations", async () => {
    const analytics: OrgAnalytics = {
      assessmentsByStatus: [{ status: "report_issued", count: 3 }],
      byTemplate: [{ templateCode: "SE1", sessionCount: 3, medianReviewerMinutes: 42.5 }],
      completionRate: { startedCount: 4, completedCount: 3, rate: 0.75, definition: "definition." },
      challengeRate: { reportedCount: 3, challengedCount: 1, rate: 1 / 3, definition: "definition." },
    };
    stubFetchJson(() => analytics);
    const { container } = render(routerFor("/org/org-1/analytics", "/org/:orgId/analytics", <AnalyticsPage />));
    await screen.findByText("report_issued");
    await expectNoViolations(container);
  });

  it("CandidatesPage has no axe violations", async () => {
    stubFetchJson(() => ({ items: [], nextCursor: null }));
    const { container } = render(routerFor("/org/org-1/candidates", "/org/:orgId/candidates", <CandidatesPage />));
    await screen.findByText("No candidates yet");
    await expectNoViolations(container);
  });

  it("CompliancePage has no axe violations", async () => {
    stubFetchJson((path) => {
      if (path.includes("/retention-policy")) {
        return {
          policy: {
            evidence_retention_days: 180,
            integrity_retention_days: 90,
            audit_retention_days: 730,
            deletion_mode: "anonymise_then_delete",
            updated_at: new Date().toISOString(),
          },
          lastRun: null,
          nextDueEstimateNote: "note",
        };
      }
      if (path.includes("/audit/search")) return { items: [], total: 0, limit: 25, offset: 0 };
      if (path.includes("/data-rights")) return [];
      return {};
    });
    const { container } = render(routerFor("/org/org-1/compliance", "/org/:orgId/compliance", <CompliancePage />));
    await screen.findByText("Audit explorer");
    await expectNoViolations(container);
  });

  it("CourseBuilderPage has no axe violations", async () => {
    const course: CourseDetail = {
      id: "c1",
      title: "Intro to Interviewing",
      description: "A short course.",
      status: "draft",
      published_checksum: null,
      published_at: null,
      modules: [
        {
          id: "m1",
          title: "Module 1",
          position: 0,
          lessons: [{ id: "l1", course_module_id: "m1", title: "Lesson 1", position: 0, practice_template_code: "SE1" }],
        },
      ],
    };
    stubFetchJson((path) => {
      if (path.includes("/users")) return [{ id: "u1", email: "a@b.com", display_name: "Ada", status: "active", mfa_enrolled: true, roles: ["reviewer"] }];
      if (path.includes("/framework/templates"))
        return [{ code: "SE1", roleFamily: "Engineering", title: "Software Engineer I", subtitle: "s", targetLevel: "L1", timebox: "90m", frameworkVersion: "1.0", criteriaCount: 18, criticalCriteriaCount: 3 }];
      return course;
    });
    const { container } = render(
      routerFor("/org/org-1/learning/admin/courses/c1", "/org/:orgId/learning/admin/courses/:courseId", <CourseBuilderPage />),
    );
    await screen.findByText("Module 1");
    await expectNoViolations(container);
  });

  it("InsightsDashboardPage has no axe violations", async () => {
    const skillsGap: SkillsGapView = {
      courses: [{ courseId: "c2", title: "Big Course", suppressed: false, enrolledCount: 20, completedCount: 10, completionRate: 0.5 }],
      suppressionNote: "note",
    };
    const aiAdoption: AiAdoptionView = {
      enrolledCount: null,
      attemptedCount: null,
      participationRate: null,
      definition: "definition.",
      suppressionNote: "note",
    };
    const tokenCost: TokenCostView = { available: false, reason: "not available." };
    stubFetchJson((path) => {
      if (path.includes("skills-gap")) return skillsGap;
      if (path.includes("ai-adoption")) return aiAdoption;
      if (path.includes("token-cost")) return tokenCost;
      return null;
    });
    const { container } = render(
      routerFor("/org/org-1/intelligence/insights", "/org/:orgId/intelligence/insights", <InsightsDashboardPage />),
    );
    await screen.findByText("Big Course");
    await expectNoViolations(container);
  });

  it("IntelligenceSettingsPage has no axe violations", async () => {
    stubFetchJson(() => ({ enabled: false, worksCouncilAcknowledgedBy: null, worksCouncilAcknowledgedAt: null, enabledAt: null }));
    const { container } = render(
      routerFor("/org/org-1/intelligence/settings", "/org/:orgId/intelligence/settings", <IntelligenceSettingsPage />),
    );
    await screen.findByText(/not enabled/);
    await expectNoViolations(container);
  });

  it("LearnerHomePage has no axe violations", async () => {
    stubFetchJson(() => []);
    const { container } = render(routerFor("/org/org-1/learning", "/org/:orgId/learning", <LearnerHomePage />));
    await screen.findByText("No enrolments yet");
    await expectNoViolations(container);
  });

  it("LearningAdminPage has no axe violations", async () => {
    stubFetchJson(() => []);
    const { container } = render(routerFor("/org/org-1/learning/admin", "/org/:orgId/learning/admin", <LearningAdminPage />));
    await screen.findByText("No courses yet");
    await expectNoViolations(container);
  });

  it("LessonPlayerPage has no axe violations", async () => {
    const detail: EnrollmentDetail = {
      id: "e1",
      status: "in_progress",
      startedAt: "2026-01-01T00:00:00Z",
      completedAt: null,
      course: {
        id: "c1",
        title: "Intro to Interviewing",
        status: "published",
        published_at: "2026-01-01T00:00:00Z",
        modules: [
          {
            id: "m1",
            title: "Module 1",
            position: 0,
            lessons: [{ id: "l1", course_module_id: "m1", title: "Lesson 1", content_markdown: "# Welcome", position: 0, practice_template_code: null, completed: false }],
          },
        ],
      },
      pathway: null,
    };
    stubFetchJson(() => detail);
    const { container } = render(
      routerFor(
        "/org/org-1/learning/enrollments/e1/lessons/l1",
        "/org/:orgId/learning/enrollments/:enrollmentId/lessons/:lessonId",
        <LessonPlayerPage />,
      ),
    );
    await screen.findByText("Welcome", { exact: false });
    await expectNoViolations(container);
  });

  it("ManagerViewPage has no axe violations", async () => {
    const view: ManagerView = {
      courses: [{ courseId: "c1", title: "Popular Course", suppressed: false, enrolledCount: 10, completedCount: 5, completionRate: 0.5 }],
      suppressionNote: "note",
    };
    stubFetchJson(() => view);
    const { container } = render(
      routerFor("/org/org-1/learning/manager-view", "/org/:orgId/learning/manager-view", <ManagerViewPage />),
    );
    await screen.findByText("Popular Course");
    await expectNoViolations(container);
  });

  it("PainPointsPage has no axe violations", async () => {
    sessionStorage.setItem("cpf.user", JSON.stringify({ id: "u-1", displayName: "Test User", email: "t@example.com" }));
    sessionStorage.setItem("cpf.memberships", JSON.stringify([{ organisationId: "org-1", role: "org_admin" }]));
    const themes: PainPointThemesView = {
      themes: [{ category: "workload", suppressed: false, count: 12 }],
      suppressionNote: "note",
    };
    stubFetchJson((path) => (path.includes("pain-point-themes") ? themes : null));
    const { container } = render(
      <MemoryRouter initialEntries={["/org/org-1/intelligence/pain-points"]}>
        <AuthProvider>
          <Routes>
            <Route path="/org/:orgId/intelligence/pain-points" element={<PainPointsPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await screen.findByText("Pain-point themes (admin view)");
    await expectNoViolations(container);
    sessionStorage.clear();
  });

  it("PathwaysPage has no axe violations", async () => {
    stubFetchJson(() => []);
    const { container } = render(routerFor("/org/org-1/learning/pathways", "/org/:orgId/learning/pathways", <PathwaysPage />));
    await screen.findByText("No pathways yet");
    await expectNoViolations(container);
  });

  it("PlatformAnalyticsPage has no axe violations", async () => {
    const analytics: PlatformAnalytics = {
      totalAssessmentsByStatus: [{ status: "report_issued", count: 12 }],
      byTemplate: [{ templateCode: "SE3", suppressed: false, sessionCount: 6, medianReviewerMinutes: 30 }],
      suppressionNote: "note",
    };
    stubFetchJson(() => analytics);
    const { container } = render(routerFor("/platform/analytics", "/platform/analytics", <PlatformAnalyticsPage />));
    await screen.findByText("SE3");
    await expectNoViolations(container);
  });

  it("PlatformOrgsPage has no axe violations", async () => {
    stubFetchJson(() => []);
    const { container } = render(routerFor("/platform/organisations", "/platform/organisations", <PlatformOrgsPage />));
    await screen.findByText("No organisations yet — onboard the first employer.");
    await expectNoViolations(container);
  });

  it("SkillsProfilePage has no axe violations", async () => {
    const profile: SkillsProfile = {
      completedCourses: [{ id: "c1", title: "Intro to Interviewing", completed_at: "2026-01-01T00:00:00Z" }],
      completedPathways: [],
      practiceAttempts: [
        {
          id: "a1",
          template_code: "SE1",
          created_at: "2026-01-02T00:00:00Z",
          profile: {
            overallEvidenceIndex: 0.8,
            overallBand: "Strong evidence",
            scoredCoverage: 1,
            evidenceNoteCoverage: 1,
            decisionSupportRoute: "standard_review",
            adjudicationsRequired: [],
            criticalConcerns: [],
            dimensions: [],
            governanceNote: "note",
          },
        },
      ],
    };
    stubFetchJson(() => profile);
    const { container } = render(
      routerFor("/org/org-1/learning/skills-profile", "/org/:orgId/learning/skills-profile", <SkillsProfilePage />),
    );
    await screen.findByText("Intro to Interviewing", { exact: false });
    await expectNoViolations(container);
  });

  it("TransparencyPage has no axe violations", async () => {
    stubFetchJson(() => ({ module: "intelligence", enabled: true }));
    const { container } = render(
      routerFor("/org/org-1/intelligence/transparency", "/org/:orgId/intelligence/transparency", <TransparencyPage />),
    );
    await screen.findByText(/currently/);
    await expectNoViolations(container);
  });

  it("WorkflowInsightsPage has no axe violations", async () => {
    const view: WorkflowInsightProposalsView = {
      proposals: [
        {
          id: "p-1",
          sourceType: "pain_point_theme",
          sourceKey: "pain_point_theme:workload",
          title: 'Address recurring "workload" pain points',
          rationale: "8 employees reported this.",
          status: "proposed",
          decidedByUserId: null,
          decidedAt: null,
          createdAt: new Date().toISOString(),
        },
      ],
    };
    stubFetchJson(() => view);
    const { container } = render(
      routerFor("/org/org-1/workflow-insights", "/org/:orgId/workflow-insights", <WorkflowInsightsPage />),
    );
    await screen.findByText(/Address recurring/);
    await expectNoViolations(container);
  });
});
