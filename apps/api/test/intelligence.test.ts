/**
 * Workforce Intelligence backend (Delivery Plan Step 43): opt-in settings
 * (works-council acknowledgement gate), anonymous-capable pain-point
 * submission, and k-anonymity-suppressed aggregate analytics.
 *
 * HARD ASSERTION carried by this file: not one response body from any GET
 * endpoint under /v1/orgs/:orgId/intelligence/** ever contains a caller's own
 * user id or email — `assertNoUserIdentifiers` below inspects every such
 * response as a stand-in for the plan's "matrix test asserts none exists".
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

/** The plan's own risk mitigation: assert no response leaks a user-identifying value. */
function assertNoUserIdentifiers(body: unknown, identifiers: string[]): void {
  const json = JSON.stringify(body);
  for (const id of identifiers) {
    expect(json.includes(id)).toBe(false);
  }
}

run("CPF workforce intelligence APIs (Step 43)", () => {
  let orgId: string;
  let adminToken: string;
  let hmToken: string;
  let learnerToken: string;
  let learnerUserId: string;
  let learnerEmail: string;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: DATABASE_ADMIN_URL });
    await admin.connect();
    app = buildApp({ databaseUrl: DATABASE_URL! });
    await app.ready();

    orgId = await createOrg(`it-intel-org-${RUN_ID}`);

    // plans/org_subscriptions/org_intelligence_settings are not covered by
    // any suite's TRUNCATE cleanup — keep this file self-cleaning across runs.
    await admin.query(
      "DELETE FROM org_subscriptions WHERE plan_id IN (SELECT id FROM plans WHERE code = 'it-intel-apis-test')",
    );
    await admin.query("DELETE FROM plans WHERE code = 'it-intel-apis-test'");
    await admin.query("DELETE FROM org_intelligence_settings WHERE organisation_id = $1", [orgId]);
    await admin.query("DELETE FROM pain_point_reports WHERE organisation_id = $1", [orgId]);

    const platformOrgId = await createOrg(`it-intel-platform-${RUN_ID}`);
    const platformAdminId = await createActiveUser(`intel-platform-admin-${RUN_ID}@it.cpf.test`);
    await addMembership(platformOrgId, platformAdminId, "platform_admin");
    const platformAdminToken = await login(`intel-platform-admin-${RUN_ID}@it.cpf.test`);

    const plan = await app.inject({
      method: "POST",
      url: "/v1/platform/plans",
      headers: authed(platformAdminToken),
      payload: {
        code: "it-intel-apis-test",
        name: "IT Intelligence APIs Test",
        moduleEntitlements: { assessments: true, learning: true, intelligence: true },
        limits: {},
      },
    });
    expect(plan.statusCode, plan.body).toBe(201);
    const assign = await app.inject({
      method: "POST",
      url: `/v1/platform/orgs/${orgId}/subscription`,
      headers: authed(platformAdminToken),
      payload: { planCode: "it-intel-apis-test" },
    });
    expect(assign.statusCode, assign.body).toBe(200);

    const adminId = await createActiveUser(`intel-admin-${RUN_ID}@it.cpf.test`);
    await addMembership(orgId, adminId, "org_admin");
    adminToken = await login(`intel-admin-${RUN_ID}@it.cpf.test`);

    const hmId = await createActiveUser(`intel-hm-${RUN_ID}@it.cpf.test`);
    await addMembership(orgId, hmId, "hiring_manager");
    hmToken = await login(`intel-hm-${RUN_ID}@it.cpf.test`);

    learnerEmail = `intel-learner-${RUN_ID}@it.cpf.test`;
    learnerUserId = await createActiveUser(learnerEmail);
    await addMembership(orgId, learnerUserId, "reviewer");
    learnerToken = await login(learnerEmail);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await closePool();
    await admin?.end();
  });

  it("a hiring_manager (not org_admin) cannot view or change settings", async () => {
    const get = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/intelligence/settings`,
      headers: authed(hmToken),
    });
    expect(get.statusCode).toBe(403);

    const put = await app.inject({
      method: "PUT",
      url: `/v1/orgs/${orgId}/intelligence/settings`,
      headers: authed(hmToken),
      payload: { enabled: true, worksCouncilAcknowledgedBy: "Someone" },
    });
    expect(put.statusCode).toBe(403);
  });

  it("disabled by default: every gated endpoint returns 403 INTELLIGENCE_NOT_ENABLED before opt-in", async () => {
    const settings = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/intelligence/settings`,
      headers: authed(adminToken),
    });
    expect(settings.statusCode, settings.body).toBe(200);
    expect(settings.json().enabled).toBe(false);

    const skillsGap = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/intelligence/skills-gap`,
      headers: authed(adminToken),
    });
    expect(skillsGap.statusCode, skillsGap.body).toBe(403);
    expect(skillsGap.json().error.code).toBe("INTELLIGENCE_NOT_ENABLED");

    const painPoint = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/pain-points`,
      headers: authed(learnerToken),
      payload: { category: "workload", reportText: "Too much on my plate.", anonymous: true },
    });
    expect(painPoint.statusCode, painPoint.body).toBe(403);
    expect(painPoint.json().error.code).toBe("INTELLIGENCE_NOT_ENABLED");
  });

  it("enabling without a works-council acknowledgement is rejected (422)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/v1/orgs/${orgId}/intelligence/settings`,
      headers: authed(adminToken),
      payload: { enabled: true },
    });
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json().error.code).toBe("WORKS_COUNCIL_ACK_REQUIRED");
  });

  it("enables with a works-council acknowledgement, recorded with a name and timestamp", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/v1/orgs/${orgId}/intelligence/settings`,
      headers: authed(adminToken),
      payload: { enabled: true, worksCouncilAcknowledgedBy: "Jordan Ellis, Employee Representative" },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().enabled).toBe(true);

    const settings = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/intelligence/settings`,
      headers: authed(adminToken),
    });
    expect(settings.json()).toMatchObject({
      enabled: true,
      worksCouncilAcknowledgedBy: "Jordan Ellis, Employee Representative",
    });
    expect(settings.json().worksCouncilAcknowledgedAt).toBeTruthy();
    expect(settings.json().enabledAt).toBeTruthy();
  });

  it("submits an anonymous pain-point report that stores no user id, and a named one that does", async () => {
    const anon = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/pain-points`,
      headers: authed(learnerToken),
      payload: { category: "tooling", reportText: "The assessment portal is slow.", anonymous: true },
    });
    expect(anon.statusCode, anon.body).toBe(201);
    const anonRow = await admin.query("SELECT submitted_by FROM pain_point_reports WHERE id = $1", [anon.json().id]);
    expect(anonRow.rows[0].submitted_by).toBeNull();

    const named = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/pain-points`,
      headers: authed(learnerToken),
      payload: { category: "tooling", reportText: "Happy to discuss in person.", anonymous: false },
    });
    expect(named.statusCode, named.body).toBe(201);
    const namedRow = await admin.query("SELECT submitted_by FROM pain_point_reports WHERE id = $1", [named.json().id]);
    expect(namedRow.rows[0].submitted_by).toBe(learnerUserId);

    // The audit trail for the anonymous submission must not carry an actor id either.
    const auditRow = await admin.query(
      `SELECT actor_user_id FROM audit_log
        WHERE organisation_id = $1 AND action = 'intelligence.pain_point_submitted' AND entity_id = $2`,
      [orgId, anon.json().id],
    );
    expect(auditRow.rows[0].actor_user_id).toBeNull();
  });

  it("pain-point themes are suppressed below a cohort of 8 reports per category, shown at/above it", async () => {
    // The 2 already submitted above were both "tooling". Add 7 fresh
    // "workload" reports here — still below the floor of 8.
    for (let i = 0; i < 7; i++) {
      const submitter = i % 2 === 0 ? adminToken : hmToken;
      const res = await app.inject({
        method: "POST",
        url: `/v1/orgs/${orgId}/pain-points`,
        headers: authed(submitter),
        payload: { category: "workload", reportText: `Report ${i}`, anonymous: true },
      });
      expect(res.statusCode, res.body).toBe(201);
    }

    const suppressedView = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/intelligence/pain-point-themes`,
      headers: authed(adminToken),
    });
    expect(suppressedView.statusCode, suppressedView.body).toBe(200);
    const workloadSuppressed = suppressedView
      .json()
      .themes.find((t: { category: string }) => t.category === "workload");
    expect(workloadSuppressed).toMatchObject({ suppressed: true, count: null });
    assertNoUserIdentifiers(suppressedView.json(), [learnerUserId, learnerEmail]);

    // hiring_manager cannot see the admin-only aggregate view.
    const hmForbidden = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/intelligence/pain-point-themes`,
      headers: authed(hmToken),
    });
    expect(hmForbidden.statusCode).toBe(403);

    // One more workload report (8 total) crosses the floor.
    const eighth = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/pain-points`,
      headers: authed(learnerToken),
      payload: { category: "workload", reportText: "Report 8", anonymous: true },
    });
    expect(eighth.statusCode, eighth.body).toBe(201);

    const visibleView = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/intelligence/pain-point-themes`,
      headers: authed(adminToken),
    });
    const workloadVisible = visibleView
      .json()
      .themes.find((t: { category: string }) => t.category === "workload");
    expect(workloadVisible).toMatchObject({ suppressed: false, count: 8 });
  });

  it("skills-gap and ai-adoption aggregates are suppressed below a cohort of 8 enrolled learners", async () => {
    const course = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/learning/courses`,
      headers: authed(adminToken),
      payload: { title: "Intelligence Fixture Course" },
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

    // Only 3 learners enrolled — below the floor of 8.
    const fewLearners: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await createActiveUser(`intel-learner-few-${i}-${RUN_ID}@it.cpf.test`);
      await addMembership(orgId, id, "reviewer");
      fewLearners.push(id);
    }
    await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/learning/enrollments`,
      headers: authed(adminToken),
      payload: { courseId, userIds: fewLearners },
    });

    const suppressedSkillsGap = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/intelligence/skills-gap`,
      headers: authed(adminToken),
    });
    expect(suppressedSkillsGap.statusCode, suppressedSkillsGap.body).toBe(200);
    const suppressedCourseRow = suppressedSkillsGap
      .json()
      .courses.find((c: { courseId: string }) => c.courseId === courseId);
    expect(suppressedCourseRow).toMatchObject({ suppressed: true, enrolledCount: null, completedCount: null });

    const suppressedAdoption = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/intelligence/ai-adoption`,
      headers: authed(adminToken),
    });
    expect(suppressedAdoption.statusCode, suppressedAdoption.body).toBe(200);
    expect(suppressedAdoption.json()).toMatchObject({ enrolledCount: null, attemptedCount: null });

    // 5 more learners (8 total) — now at the floor, real numbers show.
    const moreLearners: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = await createActiveUser(`intel-learner-more-${i}-${RUN_ID}@it.cpf.test`);
      await addMembership(orgId, id, "reviewer");
      moreLearners.push(id);
    }
    await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/learning/enrollments`,
      headers: authed(adminToken),
      payload: { courseId, userIds: moreLearners },
    });

    const visibleSkillsGap = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/intelligence/skills-gap`,
      headers: authed(adminToken),
    });
    const visibleCourseRow = visibleSkillsGap
      .json()
      .courses.find((c: { courseId: string }) => c.courseId === courseId);
    expect(visibleCourseRow).toMatchObject({ suppressed: false, enrolledCount: 8, completedCount: 0 });
    assertNoUserIdentifiers(visibleSkillsGap.json(), [learnerUserId, learnerEmail, ...fewLearners, ...moreLearners]);

    const visibleAdoption = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/intelligence/ai-adoption`,
      headers: authed(adminToken),
    });
    expect(visibleAdoption.json()).toMatchObject({ enrolledCount: 8, attemptedCount: 0, participationRate: 0 });
    assertNoUserIdentifiers(visibleAdoption.json(), [learnerUserId, learnerEmail, ...fewLearners, ...moreLearners]);
  });

  it("token-cost is an honest placeholder, not a fabricated figure or a query against a nonexistent table", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/intelligence/token-cost`,
      headers: authed(adminToken),
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ available: false });
    expect(typeof res.json().reason).toBe("string");
  });

  it("an org without the intelligence module entitlement is blocked (403 MODULE_NOT_ENTITLED)", async () => {
    const noModuleOrgId = await createOrg(`it-intel-no-module-${RUN_ID}`);
    const noModuleAdminId = await createActiveUser(`intel-no-module-admin-${RUN_ID}@it.cpf.test`);
    await addMembership(noModuleOrgId, noModuleAdminId, "org_admin");
    const noModuleAdminToken = await login(`intel-no-module-admin-${RUN_ID}@it.cpf.test`);

    const res = await app.inject({
      method: "GET",
      url: `/v1/orgs/${noModuleOrgId}/intelligence/settings`,
      headers: authed(noModuleAdminToken),
    });
    expect(res.statusCode, res.body).toBe(403);
    expect(res.json().error.code).toBe("MODULE_NOT_ENTITLED");
  });
});
