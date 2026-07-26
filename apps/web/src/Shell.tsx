import { useMemo, type ReactNode } from "react";
import { NavLink, Navigate, Outlet, useNavigate, useParams } from "react-router";
import { useAuth } from "./auth.js";
import { routes } from "./routes.js";
import { api } from "./api.js";
import { useQuery } from "./useQuery.js";

/**
 * Authenticated application shell: left navigation filtered by the user's
 * roles in the active organisation, org switcher, and sign-out.
 */
export function Shell(): ReactNode {
  const { user, memberships, authenticated, logout } = useAuth();
  const navigate = useNavigate();
  const { orgId } = useParams();

  const orgIds = useMemo(
    () => [...new Set(memberships.map((m) => m.organisationId))],
    [memberships],
  );
  const activeOrgId = orgId ?? orgIds[0];
  const rolesInOrg = useMemo(
    () =>
      new Set(
        memberships
          .filter((m) => m.organisationId === activeOrgId)
          .map((m) => m.role),
      ),
    [memberships, activeOrgId],
  );
  const isPlatformAdmin = memberships.some((m) => m.role === "platform_admin");

  // Learning nav is gated by role AND module entitlement. Entitlement isn't
  // otherwise exposed to the client, so this reuses the cheap `/learning/status`
  // smoke-check route (kept specifically for this) — if it 404s/403s (module
  // not entitled, or no learning-relevant role), the nav simply doesn't show.
  const canSeeLearning = Boolean(activeOrgId) && (rolesInOrg.size > 0);
  const learningStatus = useQuery(
    () =>
      canSeeLearning
        ? api.get<{ module: string; enabled: boolean }>(`/v1/orgs/${activeOrgId}/learning/status`)
        : Promise.resolve(null),
    [activeOrgId, canSeeLearning],
  );
  const learningEnabled = learningStatus.data?.enabled === true;
  const isLearningAdmin = rolesInOrg.has("org_admin") || rolesInOrg.has("learning_admin");

  if (!authenticated) return <Navigate to={routes.login()} replace />;

  const canHire = rolesInOrg.has("org_admin") || rolesInOrg.has("hiring_manager");
  const isAdmin = rolesInOrg.has("org_admin");
  const isReviewer = rolesInOrg.has("reviewer");

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <nav className="shell-nav" aria-label="Primary">
        <div className="brand">CPF</div>
        {orgIds.length > 1 && activeOrgId ? (
          <div className="field">
            <label htmlFor="org-switcher">Organisation</label>
            <select
              id="org-switcher"
              value={activeOrgId}
              onChange={(e) => navigate(routes.orgSessions(e.target.value))}
            >
              {orgIds.map((id) => (
                <option key={id} value={id}>
                  {id.slice(0, 8)}…
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {activeOrgId && canHire ? (
          <>
            <NavLink to={routes.orgSessions(activeOrgId)}>Assessment pipeline</NavLink>
            <NavLink to={routes.orgCandidates(activeOrgId)}>Candidates</NavLink>
            <NavLink to={routes.orgJobProfiles(activeOrgId)}>Job profiles</NavLink>
          </>
        ) : null}
        {activeOrgId && isReviewer ? (
          <NavLink to={routes.orgReviews(activeOrgId)}>My reviews</NavLink>
        ) : null}
        {activeOrgId && isAdmin ? (
          <>
            <NavLink to={routes.orgTeam(activeOrgId)}>Team</NavLink>
            <NavLink to={routes.orgDataRights(activeOrgId)}>Data rights</NavLink>
            <NavLink to={routes.orgCompliance(activeOrgId)}>Compliance</NavLink>
            <NavLink to={routes.orgAnalytics(activeOrgId)}>Analytics</NavLink>
          </>
        ) : null}
        {activeOrgId && learningEnabled ? (
          <>
            <NavLink to={routes.orgLearningHome(activeOrgId)}>My learning</NavLink>
            <NavLink to={routes.orgLearningSkillsProfile(activeOrgId)}>My skills profile</NavLink>
          </>
        ) : null}
        {activeOrgId && learningEnabled && isLearningAdmin ? (
          <>
            <NavLink to={routes.orgLearningAdmin(activeOrgId)}>Learning admin</NavLink>
            <NavLink to={routes.orgLearningPathways(activeOrgId)}>Pathways</NavLink>
            <NavLink to={routes.orgLearningManagerView(activeOrgId)}>Learning completion</NavLink>
          </>
        ) : null}
        {isPlatformAdmin ? (
          <>
            <NavLink to={routes.platformOrgs()}>Employers</NavLink>
            <NavLink to={routes.platformAnalytics()}>Platform analytics</NavLink>
          </>
        ) : null}
        <NavLink to={routes.templates()}>Assessment library</NavLink>
        <div className="nav-footer">
          <p className="muted" style={{ padding: "0 var(--space-2)" }}>
            <small>{user?.displayName}</small>
          </p>
          <button
            type="button"
            className="btn secondary"
            style={{ width: "100%" }}
            onClick={() => {
              void logout().then(() => navigate(routes.login()));
            }}
          >
            Sign out
          </button>
        </div>
      </nav>
      <main className="shell-main" id="main">
        <Outlet />
      </main>
    </div>
  );
}
