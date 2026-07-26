/**
 * Support console / JIT access (Delivery Plan Step 37): platform staff must
 * request a time-boxed grant, an org_admin approves it, and only then can
 * the metadata-only summary endpoint be read — every step dual-logged to
 * both the platform-wide and the organisation's own audit trail.
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

async function auditRowsFor(grantId: string): Promise<Array<{ organisation_id: string | null; action: string }>> {
  const result = await admin.query<{ organisation_id: string | null; action: string }>(
    `SELECT organisation_id, action FROM audit_log WHERE entity_id = $1 ORDER BY id ASC`,
    [grantId],
  );
  return result.rows;
}

run("CPF support console / JIT access (Step 37)", () => {
  let platformOrgId: string;
  let employerOrgId: string;
  let platformAdminToken: string;
  let platformAdminId: string;
  let orgAdminToken: string;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: DATABASE_ADMIN_URL });
    await admin.connect();
    app = buildApp({ databaseUrl: DATABASE_URL! });
    await app.ready();

    platformOrgId = await createOrg("it-support-platform", "platform");
    employerOrgId = await createOrg("it-support-employer");

    // support_access_grants (and its audit_log rows) are not covered by any
    // suite's TRUNCATE cleanup — keep this file self-cleaning across runs.
    await admin.query("DELETE FROM support_access_grants WHERE organisation_id = $1", [employerOrgId]);

    platformAdminId = await createActiveUser("support-platform-admin@it.cpf.test");
    await addMembership(platformOrgId, platformAdminId, "platform_admin");
    platformAdminToken = await login("support-platform-admin@it.cpf.test");

    const orgAdminId = await createActiveUser("support-org-admin@it.cpf.test");
    await addMembership(employerOrgId, orgAdminId, "org_admin");
    orgAdminToken = await login("support-org-admin@it.cpf.test");
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await closePool();
    await admin?.end();
  });

  it("denies the summary endpoint with no grant at all (403 SUPPORT_ACCESS_REQUIRED)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/support/orgs/${employerOrgId}/summary`,
      headers: authed(platformAdminToken),
    });
    expect(res.statusCode, res.body).toBe(403);
    expect(res.json().error.code).toBe("SUPPORT_ACCESS_REQUIRED");
  });

  it("denies the summary endpoint while a requested grant is still pending", async () => {
    const request = await app.inject({
      method: "POST",
      url: `/v1/support/orgs/${employerOrgId}/access-grants`,
      headers: authed(platformAdminToken),
      payload: { scope: "read_metadata", reason: "Investigating a candidate-reported bug." },
    });
    expect(request.statusCode, request.body).toBe(201);
    expect(request.json().status).toBe("pending");

    const res = await app.inject({
      method: "GET",
      url: `/v1/support/orgs/${employerOrgId}/summary`,
      headers: authed(platformAdminToken),
    });
    expect(res.statusCode, res.body).toBe(403);
    expect(res.json().error.code).toBe("SUPPORT_ACCESS_REQUIRED");
  });

  it("allows the summary once the org_admin approves the grant, and dual-logs every step", async () => {
    const request = await app.inject({
      method: "POST",
      url: `/v1/support/orgs/${employerOrgId}/access-grants`,
      headers: authed(platformAdminToken),
      payload: { scope: "read_metadata", reason: "Investigating a second candidate-reported bug." },
    });
    expect(request.statusCode, request.body).toBe(201);
    const grantId = request.json().id as string;

    const approve = await app.inject({
      method: "POST",
      url: `/v1/support/orgs/${employerOrgId}/access-grants/${grantId}/approve`,
      headers: authed(orgAdminToken),
    });
    expect(approve.statusCode, approve.body).toBe(200);
    expect(approve.json().status).toBe("approved");

    const summary = await app.inject({
      method: "GET",
      url: `/v1/support/orgs/${employerOrgId}/summary`,
      headers: authed(platformAdminToken),
    });
    expect(summary.statusCode, summary.body).toBe(200);
    const body = summary.json();
    expect(body.organisationId).toBe(employerOrgId);
    expect(body).toHaveProperty("invitationCount");
    expect(body).toHaveProperty("orgUserCount");
    expect(body).toHaveProperty("sessionsByStatus");
    // Metadata only — no evidence content should ever appear on this endpoint.
    expect(JSON.stringify(body)).not.toMatch(/evidence/i);

    const rows = await auditRowsFor(grantId);
    const actions = rows.map((r) => r.action);
    expect(actions).toContain("support.access_requested");
    expect(actions).toContain("platform.support_access_requested");
    expect(actions).toContain("support.access_approved");
    expect(actions).toContain("platform.support_access_approved");
    expect(rows.some((r) => r.organisation_id === employerOrgId)).toBe(true);
    expect(rows.some((r) => r.organisation_id === null)).toBe(true);

    // The summary read itself is also dual-logged, keyed by the org id (not the grant id).
    const summaryRows = await admin.query<{ organisation_id: string | null; action: string }>(
      `SELECT organisation_id, action FROM audit_log WHERE entity_id = $1 AND action LIKE '%summary_accessed'`,
      [employerOrgId],
    );
    expect(summaryRows.rows.some((r) => r.organisation_id === employerOrgId)).toBe(true);
    expect(summaryRows.rows.some((r) => r.organisation_id === null)).toBe(true);
  });

  it("denies the summary again once the grant expires (403 SUPPORT_ACCESS_REQUIRED)", async () => {
    // The guard checks "does this platform user hold ANY active grant for
    // this org", not a specific grant id — force-expire the still-active
    // grant from the previous test first, so only the new grant (which this
    // test itself expires below) is in play.
    await admin.query(
      `UPDATE support_access_grants SET expires_at = now() - interval '1 minute'
        WHERE organisation_id = $1 AND platform_user_id = $2 AND status = 'approved'`,
      [employerOrgId, platformAdminId],
    );

    const request = await app.inject({
      method: "POST",
      url: `/v1/support/orgs/${employerOrgId}/access-grants`,
      headers: authed(platformAdminToken),
      payload: { scope: "read_metadata", reason: "A grant that will be force-expired by the test." },
    });
    const grantId = request.json().id as string;
    await app.inject({
      method: "POST",
      url: `/v1/support/orgs/${employerOrgId}/access-grants/${grantId}/approve`,
      headers: authed(orgAdminToken),
    });
    await admin.query(
      `UPDATE support_access_grants SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      [grantId],
    );

    const res = await app.inject({
      method: "GET",
      url: `/v1/support/orgs/${employerOrgId}/summary`,
      headers: authed(platformAdminToken),
    });
    expect(res.statusCode, res.body).toBe(403);
    expect(res.json().error.code).toBe("SUPPORT_ACCESS_REQUIRED");
  });

  it("supports break-glass self-approval by a platform_admin, dual-logged distinctly", async () => {
    const request = await app.inject({
      method: "POST",
      url: `/v1/support/orgs/${employerOrgId}/access-grants`,
      headers: authed(platformAdminToken),
      payload: {
        scope: "read_metadata",
        reason: "Production incident, org_admin unreachable, break-glass invoked.",
        breakGlass: true,
      },
    });
    expect(request.statusCode, request.body).toBe(201);
    expect(request.json().status).toBe("approved");
    const grantId = request.json().id as string;

    const summary = await app.inject({
      method: "GET",
      url: `/v1/support/orgs/${employerOrgId}/summary`,
      headers: authed(platformAdminToken),
    });
    expect(summary.statusCode, summary.body).toBe(200);

    const rows = await auditRowsFor(grantId);
    const actions = rows.map((r) => r.action);
    expect(actions).toContain("support.access_break_glass");
    expect(actions).toContain("platform.support_access_break_glass");
  });

  it("rejects a non-platform-admin's attempt to request a grant", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/support/orgs/${employerOrgId}/access-grants`,
      headers: authed(orgAdminToken),
      payload: { scope: "read_metadata", reason: "Trying to self-grant without platform_admin rights." },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a non-org_admin's (or wrong org's) attempt to approve a grant", async () => {
    const request = await app.inject({
      method: "POST",
      url: `/v1/support/orgs/${employerOrgId}/access-grants`,
      headers: authed(platformAdminToken),
      payload: { scope: "read_metadata", reason: "Grant that only the real org_admin should approve." },
    });
    const grantId = request.json().id as string;

    const res = await app.inject({
      method: "POST",
      url: `/v1/support/orgs/${employerOrgId}/access-grants/${grantId}/approve`,
      headers: authed(platformAdminToken),
    });
    expect(res.statusCode).toBe(403);
  });
});
