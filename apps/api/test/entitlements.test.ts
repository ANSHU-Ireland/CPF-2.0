/**
 * Entitlement enforcement (Delivery Plan Step 36): module gate
 * (requireModuleEntitlement) across the assessments-module routes, the
 * maxActiveAssessments plan limit on invitation creation, the not-yet-built
 * Learning module's placeholder route, and the /usage endpoint.
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

const PW = "a-long-test-password-1234";

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

async function createOrg(slug: string, type = "employer"): Promise<string> {
  const result = await getPool().query<{ id: string }>(
    `INSERT INTO organisations (slug, name, type) VALUES ($1, $2, $3::organisation_type)
     ON CONFLICT (slug) DO UPDATE SET updated_at = now(), status = 'active' RETURNING id`,
    [slug, `Org ${slug}`, type],
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

const authed = (token: string) => ({ authorization: `Bearer ${token}` });

run("CPF entitlement enforcement (Step 36)", () => {
  let platformOrgId: string;
  let employerOrgId: string;
  let platformAdminToken: string;
  let orgAdminToken: string;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: DATABASE_ADMIN_URL });
    await admin.connect();
    app = buildApp({ databaseUrl: DATABASE_URL! });
    await app.ready();

    platformOrgId = await createOrg("it-ent-platform", "platform");
    employerOrgId = await createOrg("it-ent-employer");

    // plans/org_subscriptions are not covered by any suite's TRUNCATE cleanup
    // — keep this file self-cleaning/idempotent across repeated runs. The
    // subscription row must go first (fk to plans).
    await admin.query("DELETE FROM org_subscriptions WHERE organisation_id = $1", [employerOrgId]);
    await admin.query("DELETE FROM plans WHERE code IN ('it-limit-test', 'it-learning-test')");

    const platformAdminId = await createActiveUser("ent-platform-admin@it.cpf.test");
    await addMembership(platformOrgId, platformAdminId, "platform_admin");
    platformAdminToken = await login("ent-platform-admin@it.cpf.test");

    const orgAdminId = await createActiveUser("ent-org-admin@it.cpf.test");
    await addMembership(employerOrgId, orgAdminId, "org_admin");
    orgAdminToken = await login("ent-org-admin@it.cpf.test");
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await closePool();
    await admin?.end();
  });

  async function createInvitation(candidateEmail: string): Promise<{ status: number; body: unknown }> {
    const job = await app.inject({
      method: "POST",
      url: `/v1/orgs/${employerOrgId}/job-profiles`,
      headers: authed(orgAdminToken),
      payload: { title: "Backend Engineer", roleFamily: "software-engineering" },
    });
    expect(job.statusCode, job.body).toBe(201);

    const candidate = await app.inject({
      method: "POST",
      url: `/v1/orgs/${employerOrgId}/candidates`,
      headers: authed(orgAdminToken),
      payload: { email: candidateEmail, fullName: "Test Candidate" },
    });
    expect(candidate.statusCode, candidate.body).toBe(201);

    const invitation = await app.inject({
      method: "POST",
      url: `/v1/orgs/${employerOrgId}/invitations`,
      headers: authed(orgAdminToken),
      payload: { candidateId: candidate.json().id, jobProfileId: job.json().id, templateCode: "SE1" },
    });
    return { status: invitation.statusCode, body: invitation.json() };
  }

  it("an org with no subscription defaults to assessments entitled (legacy baseline)", async () => {
    const res = await createInvitation("ent-baseline-candidate@candidate.test");
    expect(res.status).toBe(201);
  });

  it("blocks the not-yet-built Learning module by default (403 MODULE_NOT_ENTITLED)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/orgs/${employerOrgId}/learning/status`,
      headers: authed(orgAdminToken),
    });
    expect(res.statusCode, res.body).toBe(403);
    expect(res.json().error.code).toBe("MODULE_NOT_ENTITLED");
  });

  it("unblocks the Learning module once the org's plan grants it", async () => {
    const plan = await app.inject({
      method: "POST",
      url: "/v1/platform/plans",
      headers: authed(platformAdminToken),
      payload: {
        code: "it-learning-test",
        name: "IT Learning Test",
        moduleEntitlements: { assessments: true, learning: true },
        limits: {},
      },
    });
    expect(plan.statusCode, plan.body).toBe(201);

    const assign = await app.inject({
      method: "POST",
      url: `/v1/platform/orgs/${employerOrgId}/subscription`,
      headers: authed(platformAdminToken),
      payload: { planCode: "it-learning-test" },
    });
    expect(assign.statusCode, assign.body).toBe(200);

    const res = await app.inject({
      method: "GET",
      url: `/v1/orgs/${employerOrgId}/learning/status`,
      headers: authed(orgAdminToken),
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ module: "learning", enabled: true });
  });

  it("enforces the maxActiveAssessments plan limit on invitation creation (422 PLAN_LIMIT_REACHED)", async () => {
    const plan = await app.inject({
      method: "POST",
      url: "/v1/platform/plans",
      headers: authed(platformAdminToken),
      payload: {
        code: "it-limit-test",
        name: "IT Limit Test",
        moduleEntitlements: { assessments: true },
        limits: { maxActiveAssessments: 1 },
      },
    });
    expect(plan.statusCode, plan.body).toBe(201);

    const assign = await app.inject({
      method: "POST",
      url: `/v1/platform/orgs/${employerOrgId}/subscription`,
      headers: authed(platformAdminToken),
      payload: { planCode: "it-limit-test" },
    });
    expect(assign.statusCode, assign.body).toBe(200);

    // One active invitation already exists from the baseline test above.
    const blocked = await createInvitation("ent-limit-candidate-1@candidate.test");
    expect(blocked.status).toBe(422);
    expect((blocked.body as { error: { code: string } }).error.code).toBe("PLAN_LIMIT_REACHED");
  });

  it("reports usage vs. plan limits on GET /v1/orgs/:orgId/usage", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/orgs/${employerOrgId}/usage`,
      headers: authed(orgAdminToken),
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.plan.code).toBe("it-limit-test");
    expect(body.usage.activeAssessments.limit).toBe(1);
    expect(body.usage.activeAssessments.used).toBeGreaterThanOrEqual(1);
  });
});
