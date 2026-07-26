/**
 * Subscriptions & entitlements (Delivery Plan Step 35): platform_admin-only
 * plan management + org suspend/resume, and enforcement of suspension across
 * every org-scoped route via requireOrgRole.
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

run("CPF subscriptions & entitlements (Step 35)", () => {
  let platformOrgId: string;
  let employerOrgId: string;
  let platformAdminToken: string;
  let orgAdminToken: string;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: DATABASE_ADMIN_URL });
    await admin.connect();
    app = buildApp({ databaseUrl: DATABASE_URL! });
    await app.ready();
    // plans is not part of any other suite's TRUNCATE cleanup list — remove
    // this file's own test artefact so re-runs stay deterministic.
    await admin.query("DELETE FROM plans WHERE code = 'it-test-plan'");

    platformOrgId = await createOrg("it-subs-platform", "platform");
    employerOrgId = await createOrg("it-subs-employer");

    const platformAdminId = await createActiveUser("subs-platform-admin@it.cpf.test");
    await addMembership(platformOrgId, platformAdminId, "platform_admin");
    platformAdminToken = await login("subs-platform-admin@it.cpf.test");

    const orgAdminId = await createActiveUser("subs-org-admin@it.cpf.test");
    await addMembership(employerOrgId, orgAdminId, "org_admin");
    orgAdminToken = await login("subs-org-admin@it.cpf.test");
  }, 120_000);

  afterAll(async () => {
    // Leave the org active for any later-running suite (defensive, in case
    // of shared-fixture ordering); this test file always resumes what it
    // suspends within its own tests.
    await admin?.query("UPDATE organisations SET status = 'active' WHERE id = $1", [employerOrgId]);
    await app?.close();
    await closePool();
    await admin?.end();
  });

  it("seeds the internal-pilot plan, visible to platform_admin", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/platform/plans",
      headers: authed(platformAdminToken),
    });
    expect(res.statusCode, res.body).toBe(200);
    const plans = res.json() as Array<{ code: string }>;
    expect(plans.some((p) => p.code === "internal-pilot")).toBe(true);
  });

  it("denies plan listing to a non-platform-admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/platform/plans", headers: authed(orgAdminToken) });
    expect(res.statusCode).toBe(403);
  });

  it("platform_admin can create a new plan", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/platform/plans",
      headers: authed(platformAdminToken),
      payload: {
        code: "it-test-plan",
        name: "Integration Test Plan",
        moduleEntitlements: { assessments: true },
        limits: { maxActiveAssessments: 5, maxOrgUsers: 3 },
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().code).toBe("it-test-plan");
  });

  it("platform_admin can assign a plan to an organisation", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/platform/orgs/${employerOrgId}/subscription`,
      headers: authed(platformAdminToken),
      payload: { planCode: "internal-pilot" },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ planCode: "internal-pilot", status: "active" });
  });

  it("rejects assigning a non-existent plan", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/platform/orgs/${employerOrgId}/subscription`,
      headers: authed(platformAdminToken),
      payload: { planCode: "does-not-exist" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("suspends an org: every org-scoped route now returns 403 ORG_SUSPENDED", async () => {
    const suspendRes = await app.inject({
      method: "POST",
      url: `/v1/platform/orgs/${employerOrgId}/suspend`,
      headers: authed(platformAdminToken),
    });
    expect(suspendRes.statusCode, suspendRes.body).toBe(200);

    const usersRes = await app.inject({
      method: "GET",
      url: `/v1/orgs/${employerOrgId}/users`,
      headers: authed(orgAdminToken),
    });
    expect(usersRes.statusCode, usersRes.body).toBe(403);
    expect(usersRes.json().error.code).toBe("ORG_SUSPENDED");

    const jobProfilesRes = await app.inject({
      method: "GET",
      url: `/v1/orgs/${employerOrgId}/job-profiles`,
      headers: authed(orgAdminToken),
    });
    expect(jobProfilesRes.statusCode).toBe(403);
    expect(jobProfilesRes.json().error.code).toBe("ORG_SUSPENDED");
  });

  it("does not affect a different, active organisation", async () => {
    // A brand-new org for this assertion, kept active throughout.
    const otherOrgId = await createOrg("it-subs-employer-other");
    const otherAdminId = await createActiveUser("subs-other-admin@it.cpf.test");
    await addMembership(otherOrgId, otherAdminId, "org_admin");
    const otherToken = await login("subs-other-admin@it.cpf.test");

    const res = await app.inject({
      method: "GET",
      url: `/v1/orgs/${otherOrgId}/users`,
      headers: authed(otherToken),
    });
    expect(res.statusCode).not.toBe(403);
  });

  it("resumes the org: org-scoped routes work again", async () => {
    const resumeRes = await app.inject({
      method: "POST",
      url: `/v1/platform/orgs/${employerOrgId}/resume`,
      headers: authed(platformAdminToken),
    });
    expect(resumeRes.statusCode, resumeRes.body).toBe(200);

    const usersRes = await app.inject({
      method: "GET",
      url: `/v1/orgs/${employerOrgId}/users`,
      headers: authed(orgAdminToken),
    });
    expect(usersRes.statusCode, usersRes.body).toBe(200);
  });

  it("suspend/resume on a non-existent organisation return 404", async () => {
    const dummyId = "00000000-0000-0000-0000-000000000099";
    const suspendRes = await app.inject({
      method: "POST",
      url: `/v1/platform/orgs/${dummyId}/suspend`,
      headers: authed(platformAdminToken),
    });
    expect(suspendRes.statusCode).toBe(404);
  });
});
