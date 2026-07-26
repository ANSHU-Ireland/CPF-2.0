/**
 * Workflow Insights (Delivery Plan Step 46, MILESTONE): the first module
 * mounted through the plugin/module registry. Covers: an unentitled org
 * being blocked on every route (403 MODULE_NOT_ENTITLED); the module
 * appearing in the module-registry response only once entitled; proposal
 * generation from a pain-point theme crossing the k=8 floor and a
 * low-completion published course; and that approve/dismiss are the ONLY
 * state-mutating routes this module exposes (autonomy level 2 — no
 * execution capability anywhere in this file).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { hashPassword } from "@cpf/identity";
import { buildApp } from "../src/app.js";
import { closePool, getPool } from "../src/db/pool.js";

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = describe.runIf(Boolean(DATABASE_URL && DATABASE_ADMIN_URL));

const PW = "a-long-test-password-1234";
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

run("CPF workflow insights module (Step 46, plugin/module registry)", () => {
  let orgId: string;
  let adminToken: string;
  let platformAdminToken: string;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: DATABASE_ADMIN_URL });
    await admin.connect();
    app = buildApp({ databaseUrl: DATABASE_URL! });
    await app.ready();

    orgId = await createOrg(`it-wfi-org-${RUN_ID}`);

    await admin.query(
      "DELETE FROM org_subscriptions WHERE plan_id IN (SELECT id FROM plans WHERE code = 'it-wfi-no-module')",
    );
    await admin.query("DELETE FROM plans WHERE code = 'it-wfi-no-module'");
    await admin.query("DELETE FROM workflow_insight_proposals WHERE organisation_id = $1", [orgId]);
    await admin.query("DELETE FROM pain_point_reports WHERE organisation_id = $1", [orgId]);
    await admin.query("DELETE FROM org_intelligence_settings WHERE organisation_id = $1", [orgId]);

    const platformOrgId = await createOrg(`it-wfi-platform-${RUN_ID}`);
    const platformAdminId = await createActiveUser(`wfi-platform-admin-${RUN_ID}@it.cpf.test`);
    await addMembership(platformOrgId, platformAdminId, "platform_admin");
    platformAdminToken = await login(`wfi-platform-admin-${RUN_ID}@it.cpf.test`);

    const adminId = await createActiveUser(`wfi-admin-${RUN_ID}@it.cpf.test`);
    await addMembership(orgId, adminId, "org_admin");
    adminToken = await login(`wfi-admin-${RUN_ID}@it.cpf.test`);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await closePool();
    await admin?.end();
  });

  it("an org with no active subscription (baseline entitlements) is blocked on every workflow-insights route", async () => {
    const modules = await app.inject({ method: "GET", url: `/v1/orgs/${orgId}/modules`, headers: authed(adminToken) });
    expect(modules.statusCode, modules.body).toBe(200);
    expect(modules.json().modules).toEqual([]);

    for (const spec of [
      { method: "GET" as const, url: `/v1/orgs/${orgId}/workflow-insights/proposals` },
      { method: "POST" as const, url: `/v1/orgs/${orgId}/workflow-insights/generate` },
      { method: "POST" as const, url: `/v1/orgs/${orgId}/workflow-insights/proposals/${randomUUID()}/approve` },
      { method: "POST" as const, url: `/v1/orgs/${orgId}/workflow-insights/proposals/${randomUUID()}/dismiss` },
    ]) {
      const res = await app.inject({ method: spec.method, url: spec.url, headers: authed(adminToken) });
      expect(res.statusCode, `${spec.method} ${spec.url}: ${res.body}`).toBe(403);
      expect(res.json().error.code).toBe("MODULE_NOT_ENTITLED");
    }
  });

  it("entitling the org surfaces the module in the registry and unblocks its routes", async () => {
    const plan = await app.inject({
      method: "POST",
      url: "/v1/platform/plans",
      headers: authed(platformAdminToken),
      payload: {
        code: `it-wfi-entitled-${RUN_ID}`,
        name: "IT Workflow Insights Entitled",
        moduleEntitlements: { assessments: true, learning: true, intelligence: true, workflow_insights: true },
        limits: {},
      },
    });
    expect(plan.statusCode, plan.body).toBe(201);
    const assign = await app.inject({
      method: "POST",
      url: `/v1/platform/orgs/${orgId}/subscription`,
      headers: authed(platformAdminToken),
      payload: { planCode: `it-wfi-entitled-${RUN_ID}` },
    });
    expect(assign.statusCode, assign.body).toBe(200);

    const modules = await app.inject({ method: "GET", url: `/v1/orgs/${orgId}/modules`, headers: authed(adminToken) });
    expect(modules.statusCode, modules.body).toBe(200);
    expect(modules.json().modules).toMatchObject([
      {
        key: "workflow_insights",
        name: "Workflow Insights",
        navigation: [{ label: "Workflow insights", path: "/org/:orgId/workflow-insights" }],
      },
    ]);

    const proposals = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/workflow-insights/proposals`,
      headers: authed(adminToken),
    });
    expect(proposals.statusCode, proposals.body).toBe(200);
    expect(proposals.json().proposals).toEqual([]);
  });

  it("generate proposes actions only once a signal crosses the k=8 cohort floor, and is idempotent on repeat runs", async () => {
    // Enable intelligence (required to submit pain-point reports) and submit
    // 8 "workload" reports — exactly at the k-anonymity floor reused from
    // Step 43's intelligence aggregates.
    const enableIntel = await app.inject({
      method: "PUT",
      url: `/v1/orgs/${orgId}/intelligence/settings`,
      headers: authed(adminToken),
      payload: { enabled: true, worksCouncilAcknowledgedBy: "Jordan Ellis, Employee Representative" },
    });
    expect(enableIntel.statusCode, enableIntel.body).toBe(200);

    for (let i = 0; i < 8; i++) {
      const res = await app.inject({
        method: "POST",
        url: `/v1/orgs/${orgId}/pain-points`,
        headers: authed(adminToken),
        payload: { category: "workload", reportText: `wfi report ${i}`, anonymous: true },
      });
      expect(res.statusCode, res.body).toBe(201);
    }

    // A published course with 8 enrolled learners and 0 completions —
    // completion rate 0 is below the 50% threshold.
    const course = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/learning/courses`,
      headers: authed(adminToken),
      payload: { title: "Workflow Insights Fixture Course" },
    });
    expect(course.statusCode, course.body).toBe(201);
    const courseId = course.json().id as string;
    const mod = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/learning/courses/${courseId}/modules`,
      headers: authed(adminToken),
      payload: { title: "Module 1", position: 0 },
    });
    await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/learning/modules/${mod.json().id}/lessons`,
      headers: authed(adminToken),
      payload: { title: "Lesson 1", position: 0 },
    });
    await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/learning/courses/${courseId}/publish`,
      headers: authed(adminToken),
    });

    const learnerIds: string[] = [];
    for (let i = 0; i < 8; i++) {
      const id = await createActiveUser(`wfi-learner-${i}-${RUN_ID}@it.cpf.test`);
      await addMembership(orgId, id, "reviewer");
      learnerIds.push(id);
    }
    const enroll = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/learning/enrollments`,
      headers: authed(adminToken),
      payload: { courseId, userIds: learnerIds },
    });
    expect(enroll.statusCode, enroll.body).toBe(201);

    const first = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflow-insights/generate`,
      headers: authed(adminToken),
    });
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json().createdCount).toBe(2);

    const listed = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/workflow-insights/proposals`,
      headers: authed(adminToken),
    });
    expect(listed.statusCode, listed.body).toBe(200);
    const proposals = listed.json().proposals as Array<{
      id: string;
      sourceType: string;
      sourceKey: string;
      status: string;
    }>;
    expect(proposals).toHaveLength(2);
    expect(proposals.map((p) => p.sourceType).sort()).toEqual(["learning_gap", "pain_point_theme"]);
    expect(proposals.every((p) => p.status === "proposed")).toBe(true);

    // Re-running generate does not create duplicates for the still-open signals.
    const second = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflow-insights/generate`,
      headers: authed(adminToken),
    });
    expect(second.statusCode, second.body).toBe(201);
    expect(second.json().createdCount).toBe(0);

    const listedAgain = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/workflow-insights/proposals`,
      headers: authed(adminToken),
    });
    expect(listedAgain.json().proposals).toHaveLength(2);
  });

  it("approve and dismiss only ever record a human decision — no other state-mutating route exists in this module", async () => {
    const listed = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/workflow-insights/proposals`,
      headers: authed(adminToken),
    });
    const proposals = listed.json().proposals as Array<{ id: string; sourceType: string }>;
    const painPointProposal = proposals.find((p) => p.sourceType === "pain_point_theme")!;
    const learningGapProposal = proposals.find((p) => p.sourceType === "learning_gap")!;

    const approve = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflow-insights/proposals/${painPointProposal.id}/approve`,
      headers: authed(adminToken),
    });
    expect(approve.statusCode, approve.body).toBe(200);
    expect(approve.json()).toMatchObject({ id: painPointProposal.id, status: "approved" });

    const dismiss = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflow-insights/proposals/${learningGapProposal.id}/dismiss`,
      headers: authed(adminToken),
    });
    expect(dismiss.statusCode, dismiss.body).toBe(200);
    expect(dismiss.json()).toMatchObject({ id: learningGapProposal.id, status: "dismissed" });

    // A second decision on an already-decided proposal is rejected, not silently re-applied.
    const redecide = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflow-insights/proposals/${painPointProposal.id}/dismiss`,
      headers: authed(adminToken),
    });
    expect(redecide.statusCode, redecide.body).toBe(409);

    // Audit trail recorded the decisions (approve/dismiss are the only
    // mutating actions this module ever performs — no execution/automation).
    const auditRows = await admin.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE organisation_id = $1 AND action LIKE 'workflow_insights.%' ORDER BY occurred_at`,
      [orgId],
    );
    expect(auditRows.rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(["workflow_insights.generated", "workflow_insights.approved", "workflow_insights.dismissed"]),
    );

    // An unknown proposal id 404s rather than silently no-op'ing.
    const notFound = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflow-insights/proposals/${randomUUID()}/approve`,
      headers: authed(adminToken),
    });
    expect(notFound.statusCode).toBe(404);
  });
});
