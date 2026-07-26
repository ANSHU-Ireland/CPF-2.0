/**
 * Compliance operations console (Delivery Plan Step 38): paginated/filtered
 * audit search, step-up-gated CSV export (personal-data egress), and the
 * retention policy editor.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { hashPassword } from "@cpf/identity";
import { buildApp } from "../src/app.js";
import { appendAudit } from "../src/db/audit.js";
import { closePool, getPool } from "../src/db/pool.js";

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = describe.runIf(Boolean(DATABASE_URL && DATABASE_ADMIN_URL));

const PW = "a-long-test-password-1234";
// audit_log is append-only (no DELETE/UPDATE, ever) — a fresh suffix per test
// run keeps action/entity filters exact-matching only this run's rows,
// rather than accumulating false matches from every previous run.
const RUN_ID = randomUUID().slice(0, 8);

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
     ON CONFLICT (slug) DO UPDATE SET updated_at = now(), status = 'active' RETURNING id`,
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

const authed = (token: string) => ({ authorization: `Bearer ${token}` });

run("CPF compliance operations console (Step 38)", () => {
  let orgId: string;
  let orgAdminToken: string;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: DATABASE_ADMIN_URL });
    await admin.connect();
    app = buildApp({ databaseUrl: DATABASE_URL! });
    await app.ready();

    orgId = await createOrg("it-compliance-employer");

    const orgAdminId = await createActiveUser("compliance-org-admin@it.cpf.test");
    await addMembership(orgId, orgAdminId, "org_admin");
    orgAdminToken = await login("compliance-org-admin@it.cpf.test");

    // createOrg() is a raw test-fixture insert, unlike the real org-bootstrap
    // endpoint (platform/routes.ts) which seeds a default retention_policies
    // row as part of onboarding — seed/reset it here too (unlike audit_log,
    // this table isn't append-only, so it's safe to reset to defaults on
    // every run rather than accumulating drift from a prior run's PUT test).
    await admin.query(
      `INSERT INTO retention_policies (organisation_id) VALUES ($1)
       ON CONFLICT (organisation_id) DO UPDATE SET
         evidence_retention_days = DEFAULT, integrity_retention_days = DEFAULT,
         audit_retention_days = DEFAULT, deletion_mode = DEFAULT, updated_at = now()`,
      [orgId],
    );

    // Seed a few distinguishable audit rows for this org to search/filter/export,
    // via the real appendAudit() so the global hash chain stays valid (a raw
    // INSERT with a made-up entry_hash would corrupt verifyAuditChain for
    // every other test that shares this database).
    await admin.query("BEGIN");
    await appendAudit(admin, {
      organisationId: orgId,
      action: `it.compliance_seed_one_${RUN_ID}`,
      entityType: `widget-${RUN_ID}`,
      entityId: "w-1",
      metadata: { note: "first" },
    });
    await appendAudit(admin, {
      organisationId: orgId,
      action: `it.compliance_seed_two_${RUN_ID}`,
      entityType: `gadget-${RUN_ID}`,
      entityId: "g-1",
      metadata: { note: "second" },
    });
    await admin.query("COMMIT");
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await closePool();
    await admin?.end();
  });

  it("searches the org's audit log with pagination", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/audit/search?limit=1&offset=0`,
      headers: authed(orgAdminToken),
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.items.length).toBe(1);
    expect(body.total).toBeGreaterThanOrEqual(2);
  });

  it("filters the audit log by action", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/audit/search?action=it.compliance_seed_one_${RUN_ID}`,
      headers: authed(orgAdminToken),
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].entity_id).toBe("w-1");
  });

  it("filters the audit log by entity type", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/audit/search?entityType=gadget-${RUN_ID}`,
      headers: authed(orgAdminToken),
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().total).toBe(1);
  });

  it("denies audit export without a fresh (stepped-up) session (401 STEP_UP_REQUIRED)", async () => {
    // A freshly-logged-in session is fresh by definition (login IS a full
    // re-authentication) — age it artificially past STEP_UP_FRESHNESS_MINUTES
    // to exercise the guard, the same technique integration.test.ts uses.
    await admin.query(
      "UPDATE auth_sessions SET stepped_up_at = now() - interval '10 minutes' WHERE user_id = (SELECT id FROM users WHERE email = 'compliance-org-admin@it.cpf.test')",
    );
    const res = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/audit/export`,
      headers: authed(orgAdminToken),
    });
    expect(res.statusCode, res.body).toBe(401);
    expect(res.json().error.code).toBe("STEP_UP_REQUIRED");
  });

  it("allows audit export once stepped up, and audits the export itself", async () => {
    const stepUp = await app.inject({
      method: "POST",
      url: "/v1/auth/step-up",
      headers: authed(orgAdminToken),
      payload: { password: PW },
    });
    expect(stepUp.statusCode, stepUp.body).toBe(200);

    const res = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/audit/export?action=it.compliance_seed_two_${RUN_ID}`,
      headers: authed(orgAdminToken),
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.body).toContain("id,occurred_at,action,entity_type,entity_id,actor_user_id,metadata");
    expect(res.body).toContain(`it.compliance_seed_two_${RUN_ID}`);

    const exportedAudit = await admin.query(
      `SELECT 1 FROM audit_log WHERE organisation_id = $1 AND action = 'compliance.audit_exported'`,
      [orgId],
    );
    expect(exportedAudit.rowCount).toBeGreaterThanOrEqual(1);
  });

  it("reads the org's retention policy (seeded on org creation)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/retention-policy`,
      headers: authed(orgAdminToken),
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.policy.evidence_retention_days).toBe(180);
    expect(body.policy.deletion_mode).toBe("anonymise_then_delete");
    // The retention job runs automatically for every org on a schedule (see
    // jobs/retention.ts), so lastRun may already be populated by the time
    // this assertion runs — assert on its shape rather than assuming it's
    // still null, which would be a timing-dependent flake.
    if (body.lastRun !== null) {
      expect(typeof body.lastRun.occurredAt).toBe("string");
    }
  });

  it("rejects an invalid retention policy update (validation bounds)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/v1/orgs/${orgId}/retention-policy`,
      headers: authed(orgAdminToken),
      payload: {
        evidenceRetentionDays: -5,
        integrityRetentionDays: 90,
        auditRetentionDays: 730,
        deletionMode: "anonymise_then_delete",
      },
    });
    expect(res.statusCode, res.body).toBe(400);
  });

  it("updates the retention policy and audits the change", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/v1/orgs/${orgId}/retention-policy`,
      headers: authed(orgAdminToken),
      payload: {
        evidenceRetentionDays: 200,
        integrityRetentionDays: 100,
        auditRetentionDays: 900,
        deletionMode: "hard_delete",
      },
    });
    expect(res.statusCode, res.body).toBe(200);

    const read = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/retention-policy`,
      headers: authed(orgAdminToken),
    });
    const body = read.json();
    expect(body.policy.evidence_retention_days).toBe(200);
    expect(body.policy.deletion_mode).toBe("hard_delete");

    const auditRow = await admin.query(
      `SELECT 1 FROM audit_log WHERE organisation_id = $1 AND action = 'compliance.retention_policy_updated'`,
      [orgId],
    );
    expect(auditRow.rowCount).toBeGreaterThanOrEqual(1);
  });
});
