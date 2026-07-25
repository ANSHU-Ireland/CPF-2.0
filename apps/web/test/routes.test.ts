import { describe, expect, it } from "vitest";
import { routes } from "../src/routes.js";

describe("routes — centralised path builders", () => {
  it("builds public routes", () => {
    expect(routes.login()).toBe("/login");
    expect(routes.candidateEntry()).toBe("/candidate");
    expect(routes.candidatePortal("tok_123")).toBe("/candidate/tok_123");
    expect(routes.templates()).toBe("/templates");
    expect(routes.platformOrgs()).toBe("/platform/organisations");
  });

  it("builds org-scoped routes with the orgId interpolated exactly once", () => {
    const orgId = "11111111-1111-1111-1111-111111111111";
    expect(routes.orgSessions(orgId)).toBe(`/org/${orgId}/sessions`);
    expect(routes.orgCandidates(orgId)).toBe(`/org/${orgId}/candidates`);
    expect(routes.orgJobProfiles(orgId)).toBe(`/org/${orgId}/job-profiles`);
    expect(routes.orgTeam(orgId)).toBe(`/org/${orgId}/team`);
    expect(routes.orgDataRights(orgId)).toBe(`/org/${orgId}/data-rights`);
    expect(routes.orgReviews(orgId)).toBe(`/org/${orgId}/reviews`);
  });

  it("builds nested review and session-profile routes", () => {
    const orgId = "org-1";
    expect(routes.orgReview(orgId, "review-9")).toBe("/org/org-1/reviews/review-9");
    expect(routes.sessionProfile(orgId, "session-9")).toBe("/org/org-1/sessions/session-9/profile");
  });
});
