import { useMemo, type ReactNode } from "react";
import { NavLink, Navigate, Outlet, useNavigate, useParams } from "react-router";
import { useAuth } from "./auth.js";
import { routes } from "./routes.js";

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
          </>
        ) : null}
        {isPlatformAdmin ? <NavLink to={routes.platformOrgs()}>Employers</NavLink> : null}
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
