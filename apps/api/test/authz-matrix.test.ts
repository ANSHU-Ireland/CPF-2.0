/**
 * Authorization matrix (CPF-47, Step 28): every org-scoped route × every
 * caller type, asserting that the deny-by-default boundary holds exactly
 * where the source declares it should.
 *
 * Design note (keeps this fast and low-fixture, per the plan's own risk
 * mitigation "single org fixture, reuse tokens"): Fastify's `preHandler`
 * chain (our `requireOrgRole`/`requireAuth` guards) always runs BEFORE a
 * route's own zod body validation and resource lookups. So for a caller who
 * should be DENIED, the guard itself returns 401/403 regardless of the
 * request body or whether any path-parameter resource exists. For a caller
 * who SHOULD be allowed, the guard passes and the route's own logic takes
 * over — which, given a deliberately-nonexistent dummy resource id and a
 * minimal/empty body, always resolves to something other than 401/403
 * (typically 400 validation, 404 not-found, or a real 2xx for pure
 * list/create routes). This lets the matrix assert the authorization
 * boundary precisely without constructing real sessions/reviews/claims/etc.
 * for every one of the ~30 routes under test — full business-logic behaviour
 * for those flows is already covered by integration.test.ts.
 *
 * The route table below is derived by hand from the source (guards.ts
 * preHandler registrations) but is CROSS-CHECKED against the live captured
 * route table (openapi.ts's captureRoutes): the test fails loudly if any
 * real org-scoped route is missing from the table, or if the table lists a
 * route that no longer exists — so a newly-added, unlisted route breaks CI
 * rather than silently going untested.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { hashPassword } from "@cpf/identity";
import { buildApp } from "../src/app.js";
import { closePool, getPool } from "../src/db/pool.js";

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = describe.runIf(Boolean(DATABASE_URL && DATABASE_ADMIN_URL));

const DUMMY_ID = "00000000-0000-0000-0000-000000000099";
const PW = "a-long-test-password-1234";

type OrgRole = "org_admin" | "hiring_manager" | "reviewer" | "learning_admin" | "support_agent";
const ORG_ROLES: OrgRole[] = ["org_admin", "hiring_manager", "reviewer", "learning_admin", "support_agent"];

interface RouteSpec {
  method: string;
  path: string; // Fastify :param syntax, exactly as registered
  roles: OrgRole[];
  contentType?: string;
  body?: string;
}

/** Hand-derived from every requireOrgRole(...) preHandler registration in src/modules/**. */
const ROUTE_TABLE: RouteSpec[] = [
  { method: "GET", path: "/v1/orgs/:orgId/users", roles: ["org_admin"] },
  { method: "POST", path: "/v1/orgs/:orgId/users", roles: ["org_admin"] },
  { method: "DELETE", path: "/v1/orgs/:orgId/users/:userId/roles/:role", roles: ["org_admin"] },
  { method: "POST", path: "/v1/orgs/:orgId/job-profiles", roles: ["org_admin", "hiring_manager"] },
  { method: "GET", path: "/v1/orgs/:orgId/job-profiles", roles: ["org_admin", "hiring_manager"] },
  { method: "POST", path: "/v1/orgs/:orgId/candidates", roles: ["org_admin", "hiring_manager"] },
  {
    method: "POST",
    path: "/v1/orgs/:orgId/candidates/import",
    roles: ["org_admin", "hiring_manager"],
    contentType: "text/csv",
    body: "name,email\n",
  },
  { method: "GET", path: "/v1/orgs/:orgId/candidates", roles: ["org_admin", "hiring_manager"] },
  { method: "GET", path: "/v1/orgs/:orgId/candidates/:candidateId", roles: ["org_admin", "hiring_manager"] },
  { method: "POST", path: "/v1/orgs/:orgId/invitations", roles: ["org_admin", "hiring_manager"] },
  {
    method: "POST",
    path: "/v1/orgs/:orgId/invitations/:invitationId/reissue",
    roles: ["org_admin", "hiring_manager"],
  },
  { method: "POST", path: "/v1/orgs/:orgId/sessions/:sessionId/reviews", roles: ["org_admin"] },
  { method: "POST", path: "/v1/orgs/:orgId/reviews/:reviewId/second-reviewer", roles: ["org_admin"] },
  { method: "GET", path: "/v1/orgs/:orgId/reviews/mine", roles: ["reviewer"] },
  { method: "GET", path: "/v1/orgs/:orgId/reviews/:reviewId/evidence", roles: ["reviewer"] },
  { method: "PUT", path: "/v1/orgs/:orgId/reviews/:reviewId/scores", roles: ["reviewer", "org_admin"] },
  { method: "GET", path: "/v1/orgs/:orgId/reviews/:reviewId/preview", roles: ["reviewer"] },
  { method: "POST", path: "/v1/orgs/:orgId/reviews/:reviewId/finalise", roles: ["reviewer"] },
  { method: "POST", path: "/v1/orgs/:orgId/sessions/:sessionId/issue-report", roles: ["org_admin", "hiring_manager"] },
  {
    method: "GET",
    path: "/v1/orgs/:orgId/sessions/:sessionId/evidence-profile",
    roles: ["org_admin", "hiring_manager"],
  },
  { method: "GET", path: "/v1/orgs/:orgId/sessions", roles: ["org_admin", "hiring_manager"] },
  { method: "GET", path: "/v1/orgs/:orgId/reviews/:reviewId", roles: ["org_admin", "reviewer"] },
  { method: "GET", path: "/v1/orgs/:orgId/export", roles: ["org_admin"] },
  { method: "GET", path: "/v1/orgs/:orgId/data-rights", roles: ["org_admin"] },
  { method: "POST", path: "/v1/orgs/:orgId/data-rights/:requestId/transition", roles: ["org_admin"] },
  { method: "GET", path: "/v1/orgs/:orgId/legal-holds", roles: ["org_admin"] },
  { method: "POST", path: "/v1/orgs/:orgId/legal-holds", roles: ["org_admin"] },
  { method: "POST", path: "/v1/orgs/:orgId/legal-holds/:holdId/release", roles: ["org_admin"] },
  { method: "GET", path: "/v1/orgs/:orgId/audit/verify-chain", roles: ["org_admin"] },
  {
    method: "GET",
    path: "/v1/orgs/:orgId/acknowledgements/responsible-use",
    roles: ["org_admin", "hiring_manager"],
  },
  {
    method: "POST",
    path: "/v1/orgs/:orgId/acknowledgements/responsible-use",
    roles: ["org_admin", "hiring_manager"],
  },
  { method: "GET", path: "/v1/orgs/:orgId/reviews/:reviewId/claims", roles: ["reviewer"] },
  { method: "POST", path: "/v1/orgs/:orgId/reviews/:reviewId/claims", roles: ["reviewer"] },
  { method: "PUT", path: "/v1/orgs/:orgId/reviews/:reviewId/claims/:claimId", roles: ["reviewer"] },
  { method: "DELETE", path: "/v1/orgs/:orgId/reviews/:reviewId/claims/:claimId", roles: ["reviewer"] },
  { method: "POST", path: "/v1/orgs/:orgId/reviewer-calibrations", roles: ["org_admin"] },
  { method: "GET", path: "/v1/orgs/:orgId/reviewer-calibrations", roles: ["org_admin"] },
  { method: "DELETE", path: "/v1/orgs/:orgId/reviewer-calibrations/:recordId", roles: ["org_admin"] },
  { method: "GET", path: "/v1/orgs/:orgId/usage", roles: ["org_admin"] },
  {
    method: "GET",
    path: "/v1/orgs/:orgId/learning/status",
    roles: ["org_admin", "hiring_manager", "learning_admin"],
  },
  { method: "POST", path: "/v1/orgs/:orgId/learning/courses", roles: ["org_admin", "learning_admin"] },
  { method: "GET", path: "/v1/orgs/:orgId/learning/courses", roles: ["org_admin", "learning_admin"] },
  { method: "GET", path: "/v1/orgs/:orgId/learning/courses/:courseId", roles: ["org_admin", "learning_admin"] },
  {
    method: "POST",
    path: "/v1/orgs/:orgId/learning/courses/:courseId/modules",
    roles: ["org_admin", "learning_admin"],
  },
  { method: "POST", path: "/v1/orgs/:orgId/learning/modules/:moduleId/lessons", roles: ["org_admin", "learning_admin"] },
  {
    method: "POST",
    path: "/v1/orgs/:orgId/learning/courses/:courseId/publish",
    roles: ["org_admin", "learning_admin"],
  },
  { method: "POST", path: "/v1/orgs/:orgId/learning/pathways", roles: ["org_admin", "learning_admin"] },
  { method: "GET", path: "/v1/orgs/:orgId/learning/pathways", roles: ["org_admin", "learning_admin"] },
  { method: "GET", path: "/v1/orgs/:orgId/learning/pathways/:pathwayId", roles: ["org_admin", "learning_admin"] },
  {
    method: "POST",
    path: "/v1/orgs/:orgId/learning/pathways/:pathwayId/courses",
    roles: ["org_admin", "learning_admin"],
  },
  { method: "POST", path: "/v1/orgs/:orgId/learning/enrollments", roles: ["org_admin", "learning_admin"] },
  {
    method: "GET",
    path: "/v1/orgs/:orgId/learning/my-enrollments",
    roles: ["org_admin", "hiring_manager", "reviewer", "learning_admin", "support_agent"],
  },
  {
    method: "PUT",
    path: "/v1/orgs/:orgId/learning/enrollments/:enrollmentId/lessons/:lessonId/progress",
    roles: ["org_admin", "hiring_manager", "reviewer", "learning_admin", "support_agent"],
    body: { completed: true },
  },
  {
    method: "POST",
    path: "/v1/orgs/:orgId/learning/enrollments/:enrollmentId/complete",
    roles: ["org_admin", "hiring_manager", "reviewer", "learning_admin", "support_agent"],
  },
  {
    method: "POST",
    path: "/v1/orgs/:orgId/learning/enrollments/:enrollmentId/lessons/:lessonId/practice-attempt",
    roles: ["org_admin", "hiring_manager", "reviewer", "learning_admin", "support_agent"],
    body: { assessments: [] },
  },
  {
    method: "GET",
    path: "/v1/orgs/:orgId/learning/enrollments/:enrollmentId",
    roles: ["org_admin", "hiring_manager", "reviewer", "learning_admin", "support_agent"],
  },
  {
    method: "GET",
    path: "/v1/orgs/:orgId/learning/my-skills-profile",
    roles: ["org_admin", "hiring_manager", "reviewer", "learning_admin", "support_agent"],
  },
  { method: "GET", path: "/v1/orgs/:orgId/learning/manager-view", roles: ["org_admin", "learning_admin"] },
  { method: "GET", path: "/v1/orgs/:orgId/audit/search", roles: ["org_admin"] },
  { method: "GET", path: "/v1/orgs/:orgId/audit/export", roles: ["org_admin"] },
  { method: "GET", path: "/v1/orgs/:orgId/retention-policy", roles: ["org_admin"] },
  { method: "GET", path: "/v1/orgs/:orgId/analytics", roles: ["org_admin"] },
  {
    method: "PUT",
    path: "/v1/orgs/:orgId/retention-policy",
    roles: ["org_admin"],
    body: { evidenceRetentionDays: 180, integrityRetentionDays: 90, auditRetentionDays: 730, deletionMode: "hard_delete" },
    contentType: "application/json",
  },
  { method: "GET", path: "/v1/orgs/:orgId/intelligence/settings", roles: ["org_admin"] },
  {
    method: "PUT",
    path: "/v1/orgs/:orgId/intelligence/settings",
    roles: ["org_admin"],
    // Deliberately omits worksCouncilAcknowledgedBy: an allowed org_admin
    // caller passes the authz gate and hits the route's own 422 validation
    // (not 401/403, satisfying the matrix's "passed the gate" check) WITHOUT
    // ever writing to org_intelligence_settings — a body of {enabled:false}
    // would actually disable the fixture org's intelligence-enabled flag for
    // real on the way through, breaking every later route in this table that
    // depends on it staying enabled.
    body: { enabled: true },
  },
  {
    method: "POST",
    path: "/v1/orgs/:orgId/pain-points",
    roles: ["org_admin", "hiring_manager", "reviewer", "learning_admin", "support_agent"],
    body: { category: "workload", reportText: "matrix test report", anonymous: true },
  },
  { method: "GET", path: "/v1/orgs/:orgId/intelligence/pain-point-themes", roles: ["org_admin"] },
  { method: "GET", path: "/v1/orgs/:orgId/intelligence/skills-gap", roles: ["org_admin"] },
  { method: "GET", path: "/v1/orgs/:orgId/intelligence/ai-adoption", roles: ["org_admin"] },
  { method: "GET", path: "/v1/orgs/:orgId/intelligence/token-cost", roles: ["org_admin"] },
];

function resolvePath(spec: RouteSpec, orgId: string): string {
  return spec.path
    .split("/")
    .map((segment) => {
      if (!segment.startsWith(":")) return segment;
      const name = segment.slice(1);
      if (name === "orgId") return orgId;
      if (name === "role") return "hiring_manager";
      return DUMMY_ID;
    })
    .join("/");
}

let app: FastifyInstance;
let admin: pg.Client;

async function createActiveUser(email: string): Promise<string> {
  const hash = await hashPassword(PW);
  const result = await getPool().query<{ id: string }>(
    `INSERT INTO users (email, display_name, status, password_hash)
     VALUES ($1, $2, 'active', $3)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, status = 'active'
     RETURNING id`,
    [email, `Test ${email}`, hash],
  );
  return result.rows[0]!.id;
}

async function createOrg(slug: string): Promise<string> {
  const result = await getPool().query<{ id: string }>(
    `INSERT INTO organisations (slug, name, type) VALUES ($1, $2, 'employer'::organisation_type)
     ON CONFLICT (slug) DO UPDATE SET updated_at = now() RETURNING id`,
    [slug, `Org ${slug}`],
  );
  return result.rows[0]!.id;
}

async function addMembership(orgId: string, userId: string, role: string): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
    await client.query(
      `INSERT INTO org_memberships (organisation_id, user_id, role)
       VALUES ($1, $2, $3::org_role) ON CONFLICT (organisation_id, user_id, role) DO NOTHING`,
      [orgId, userId, role],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function login(email: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email, password: PW } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().token;
}

const authed = (token: string | null) => (token ? { authorization: `Bearer ${token}` } : {});

run("CPF authorization matrix (CPF-47)", () => {
  let orgAId: string;
  const tokens: Record<OrgRole, string> = {} as Record<OrgRole, string>;
  let crossOrgAdminToken: string;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: DATABASE_ADMIN_URL });
    await admin.connect();
    app = buildApp({ databaseUrl: DATABASE_URL! });
    await app.ready();

    orgAId = await createOrg("it-authz-org-a");
    const orgBId = await createOrg("it-authz-org-b");

    // Step 36's module-entitlement gate defaults an unsubscribed org to
    // assessments-only; grant this fixture org every module (including the
    // not-yet-built "learning" one, whose only route is a placeholder) so
    // the matrix below tests purely the ROLE boundary, not the plan boundary
    // (plan-based entitlement is covered separately in entitlements.test.ts).
    await admin.query(
      `INSERT INTO plans (code, name, module_entitlements, limits)
       VALUES ('it-authz-full-access', 'IT Authz Full Access', '{"assessments":true,"learning":true,"intelligence":true}'::jsonb, '{}'::jsonb)
       ON CONFLICT (code) DO NOTHING`,
    );
    await admin.query(
      `INSERT INTO org_subscriptions (organisation_id, plan_id)
       SELECT $1, id FROM plans WHERE code = 'it-authz-full-access'
       ON CONFLICT (organisation_id) DO UPDATE SET plan_id = EXCLUDED.plan_id, updated_at = now()`,
      [orgAId],
    );

    // Step 43's intelligence routes have a THIRD gate beyond role+plan
    // (requireIntelligenceEnabled) — enable it directly for this fixture org
    // so allowed-role callers reach the route's own logic layer rather than
    // being indistinguishable from a denied caller (both would otherwise be
    // 403). The enable-flow's own works-council-ack requirement is tested in
    // intelligence.test.ts, not here.
    await admin.query(
      `INSERT INTO org_intelligence_settings (organisation_id, enabled, works_council_acknowledged_by, works_council_acknowledged_at, enabled_at)
       VALUES ($1, true, 'IT Fixture Works Council Rep', now(), now())
       ON CONFLICT (organisation_id) DO UPDATE SET enabled = true, updated_at = now()`,
      [orgAId],
    );

    for (const role of ORG_ROLES) {
      const email = `authz-${role}@it.cpf.test`;
      const userId = await createActiveUser(email);
      await addMembership(orgAId, userId, role);
      tokens[role] = await login(email);
    }

    const crossAdminId = await createActiveUser("authz-cross-admin@it.cpf.test");
    await addMembership(orgBId, crossAdminId, "org_admin");
    crossOrgAdminToken = await login("authz-cross-admin@it.cpf.test");
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await closePool();
    await admin?.end();
  });

  it("covers every org-scoped route with no gaps in either direction", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/openapi.json" });
    expect(res.statusCode).toBe(200);
    const spec = res.json() as { paths: Record<string, Record<string, unknown>> };

    const liveOrgRoutes = new Set<string>();
    for (const [path, methods] of Object.entries(spec.paths)) {
      if (!path.startsWith("/v1/orgs/{orgId}")) continue;
      for (const method of Object.keys(methods)) {
        if (method.toUpperCase() === "HEAD") continue; // Fastify auto-adds HEAD for every GET
        liveOrgRoutes.add(`${method.toUpperCase()} ${path}`);
      }
    }
    const tableRoutes = new Set(
      ROUTE_TABLE.map((r) => `${r.method} ${r.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}")}`),
    );

    const missingFromTable = [...liveOrgRoutes].filter((r) => !tableRoutes.has(r));
    const staleInTable = [...tableRoutes].filter((r) => !liveOrgRoutes.has(r));

    expect(missingFromTable, "org-scoped routes registered but not covered by the authz matrix").toEqual([]);
    expect(staleInTable, "authz matrix entries referencing routes that no longer exist").toEqual([]);
  });

  for (const spec of ROUTE_TABLE) {
    it(`${spec.method} ${spec.path} — enforces ${spec.roles.join("/")} only`, async () => {
      const url = resolvePath(spec, orgAId);
      const callers: Array<{ label: string; token: string | null; allowed: boolean }> = [
        ...ORG_ROLES.map((role) => ({ label: role, token: tokens[role], allowed: spec.roles.includes(role) })),
        { label: "none", token: null, allowed: false },
        { label: "cross-org", token: crossOrgAdminToken, allowed: false },
      ];

      for (const caller of callers) {
        const headers: Record<string, string> = {
          ...authed(caller.token),
          ...(spec.contentType ? { "content-type": spec.contentType } : {}),
        };
        const res = await app.inject({
          method: spec.method,
          url,
          headers,
          payload: spec.body ?? (spec.method === "GET" || spec.method === "DELETE" ? undefined : {}),
        });
        if (caller.allowed) {
          expect(
            [401, 403].includes(res.statusCode),
            `expected ${caller.label} to pass the authz gate for ${spec.method} ${spec.path}, got ${res.statusCode}: ${res.body}`,
          ).toBe(false);
        } else {
          const expectedStatus = caller.label === "none" ? 401 : 403;
          expect(
            res.statusCode,
            `expected ${caller.label} to be denied (${expectedStatus}) for ${spec.method} ${spec.path}, got ${res.statusCode}: ${res.body}`,
          ).toBe(expectedStatus);
        }
      }
    });
  }
}, 60_000);
