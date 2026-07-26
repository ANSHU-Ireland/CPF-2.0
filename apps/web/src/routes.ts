/**
 * Centralised route path builders. Never hand-write a `/org/:orgId/...`
 * string elsewhere — import from here so route params can't drift from the
 * route table declared in main.tsx.
 */
export const routes = {
  login: () => "/login",
  candidateEntry: () => "/candidate",
  candidatePortal: (token: string) => `/candidate/${token}`,
  platformOrgs: () => "/platform/organisations",
  templates: () => "/templates",
  orgSessions: (orgId: string) => `/org/${orgId}/sessions`,
  orgCandidates: (orgId: string) => `/org/${orgId}/candidates`,
  orgJobProfiles: (orgId: string) => `/org/${orgId}/job-profiles`,
  orgTeam: (orgId: string) => `/org/${orgId}/team`,
  orgDataRights: (orgId: string) => `/org/${orgId}/data-rights`,
  orgCompliance: (orgId: string) => `/org/${orgId}/compliance`,
  orgReviews: (orgId: string) => `/org/${orgId}/reviews`,
  orgReview: (orgId: string, reviewId: string) => `/org/${orgId}/reviews/${reviewId}`,
  sessionProfile: (orgId: string, sessionId: string) =>
    `/org/${orgId}/sessions/${sessionId}/profile`,
};
