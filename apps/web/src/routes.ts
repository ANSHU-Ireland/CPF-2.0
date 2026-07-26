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
  orgAnalytics: (orgId: string) => `/org/${orgId}/analytics`,
  platformAnalytics: () => "/platform/analytics",
  orgReviews: (orgId: string) => `/org/${orgId}/reviews`,
  orgReview: (orgId: string, reviewId: string) => `/org/${orgId}/reviews/${reviewId}`,
  sessionProfile: (orgId: string, sessionId: string) =>
    `/org/${orgId}/sessions/${sessionId}/profile`,
  orgLearningHome: (orgId: string) => `/org/${orgId}/learning`,
  orgLearningAdmin: (orgId: string) => `/org/${orgId}/learning/admin`,
  orgLearningCourseBuilder: (orgId: string, courseId: string) =>
    `/org/${orgId}/learning/admin/courses/${courseId}`,
  orgLearningPathways: (orgId: string) => `/org/${orgId}/learning/pathways`,
  orgLearningLesson: (orgId: string, enrollmentId: string, lessonId: string) =>
    `/org/${orgId}/learning/enrollments/${enrollmentId}/lessons/${lessonId}`,
  orgLearningManagerView: (orgId: string) => `/org/${orgId}/learning/manager-view`,
  orgLearningSkillsProfile: (orgId: string) => `/org/${orgId}/learning/skills-profile`,
  orgIntelligenceSettings: (orgId: string) => `/org/${orgId}/intelligence/settings`,
  orgPainPoints: (orgId: string) => `/org/${orgId}/intelligence/pain-points`,
  orgIntelligenceInsights: (orgId: string) => `/org/${orgId}/intelligence/insights`,
  orgIntelligenceTransparency: (orgId: string) => `/org/${orgId}/intelligence/transparency`,
  orgWorkflowInsights: (orgId: string) => `/org/${orgId}/workflow-insights`,
};
