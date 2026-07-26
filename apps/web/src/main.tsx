import { StrictMode, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router";
import { AuthProvider, useAuth } from "./auth.js";
import { Shell } from "./Shell.js";
import { routes } from "./routes.js";
import { Loading, EmptyState } from "./ui.js";
import { LoginPage } from "./pages/LoginPage.js";
import { PlatformOrgsPage } from "./pages/PlatformOrgsPage.js";
import { CandidatesPage } from "./pages/CandidatesPage.js";
import { TemplatesPage } from "./pages/TemplatesPage.js";
import { JobProfilesPage } from "./pages/JobProfilesPage.js";
import { SessionsPage } from "./pages/SessionsPage.js";
import { TeamPage } from "./pages/TeamPage.js";
import { DataRightsPage } from "./pages/DataRightsPage.js";
import { CompliancePage } from "./pages/CompliancePage.js";
import { AnalyticsPage } from "./pages/AnalyticsPage.js";
import { PlatformAnalyticsPage } from "./pages/PlatformAnalyticsPage.js";
import { ReviewQueuePage } from "./pages/ReviewQueuePage.js";
import { ReviewWorkspacePage } from "./pages/ReviewWorkspacePage.js";
import { EvidenceProfilePage } from "./pages/EvidenceProfilePage.js";
import { CandidateEntryPage } from "./pages/CandidateEntryPage.js";
import { CandidatePortalPage } from "./pages/CandidatePortalPage.js";
import "./styles.css";

/** Root ("/") redirects to sign-in or a role-appropriate landing page. */
function RootRedirect(): ReactNode {
  const { authenticated, memberships } = useAuth();
  if (!authenticated) return <Navigate to={routes.login()} replace />;
  if (memberships.some((m) => m.role === "platform_admin")) {
    return <Navigate to={routes.platformOrgs()} replace />;
  }
  const first = memberships[0];
  if (first && memberships.some((m) => m.role === "reviewer")) {
    return <Navigate to={routes.orgReviews(first.organisationId)} replace />;
  }
  if (first) return <Navigate to={routes.orgSessions(first.organisationId)} replace />;
  return <Navigate to={routes.templates()} replace />;
}

function NotFoundPage(): ReactNode {
  return (
    <div className="shell-main" style={{ maxWidth: 480, margin: "10vh auto", textAlign: "center" }}>
      <EmptyState
        title="Page not found"
        hint="The page you're looking for doesn't exist, or you don't have access to it."
      />
      <p>
        <Link className="btn" to="/">
          Return home
        </Link>
      </p>
    </div>
  );
}

/**
 * Validates any restored session token against the server before rendering
 * routes, so authenticated users don't flash through /login on reload.
 */
function AppRoutes(): ReactNode {
  const { restore } = useAuth();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void restore().finally(() => setReady(true));
  }, [restore]);

  if (!ready) return <Loading label="Loading CPF…" />;

  return (
    <Routes>
      <Route path={routes.login()} element={<LoginPage />} />
      <Route path={routes.candidateEntry()} element={<CandidateEntryPage />} />
      <Route path="/candidate/:token" element={<CandidatePortalPage />} />
      <Route element={<Shell />}>
        <Route path={routes.platformOrgs()} element={<PlatformOrgsPage />} />
        <Route path={routes.platformAnalytics()} element={<PlatformAnalyticsPage />} />
        <Route path={routes.templates()} element={<TemplatesPage />} />
        <Route path="/org/:orgId/sessions" element={<SessionsPage />} />
        <Route path="/org/:orgId/candidates" element={<CandidatesPage />} />
        <Route path="/org/:orgId/job-profiles" element={<JobProfilesPage />} />
        <Route path="/org/:orgId/team" element={<TeamPage />} />
        <Route path="/org/:orgId/data-rights" element={<DataRightsPage />} />
        <Route path="/org/:orgId/compliance" element={<CompliancePage />} />
        <Route path={routes.orgAnalytics(":orgId")} element={<AnalyticsPage />} />
        <Route path="/org/:orgId/reviews" element={<ReviewQueuePage />} />
        <Route path="/org/:orgId/reviews/:reviewId" element={<ReviewWorkspacePage />} />
        <Route path="/org/:orgId/sessions/:sessionId/profile" element={<EvidenceProfilePage />} />
      </Route>
      <Route path="/" element={<RootRedirect />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("Root element #root not found");

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
