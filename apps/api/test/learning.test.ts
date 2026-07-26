/**
 * Learning APIs (Delivery Plan Step 41): course/pathway authoring, publish
 * (content-freeze checksum), bulk enrolment, learner progress, and the
 * optional practice-assessment mode that reuses the real scoring engine for
 * the learner's own reference only.
 *
 * HARD RULE assertion: a practice attempt must never insert into, or read
 * from, any hiring table (reviews/criterion_scores/assessment_sessions).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { hashPassword } from "@cpf/identity";
import { loadTemplate } from "@cpf/assessment-framework";
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

run("CPF learning APIs (Step 41)", () => {
  let orgId: string;
  let adminToken: string;
  let hmToken: string;
  let learnerUserId: string;
  let learnerToken: string;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: DATABASE_ADMIN_URL });
    await admin.connect();
    app = buildApp({ databaseUrl: DATABASE_URL! });
    await app.ready();

    orgId = await createOrg(`it-learning-org-${RUN_ID}`);

    // plans/org_subscriptions are not covered by any suite's TRUNCATE cleanup
    // — keep this file self-cleaning/idempotent across repeated runs. Clean
    // up by plan code (not by this run's randomised orgId) since a prior
    // run's now-orphaned org may still hold a subscription against the same
    // fixed plan code.
    await admin.query(
      "DELETE FROM org_subscriptions WHERE plan_id IN (SELECT id FROM plans WHERE code = 'it-learning-apis-test')",
    );
    await admin.query("DELETE FROM plans WHERE code = 'it-learning-apis-test'");

    const platformOrgId = await createOrg(`it-learning-platform-${RUN_ID}`);
    const platformAdminId = await createActiveUser(`learning-platform-admin-${RUN_ID}@it.cpf.test`);
    await addMembership(platformOrgId, platformAdminId, "platform_admin");
    const platformAdminToken = await login(`learning-platform-admin-${RUN_ID}@it.cpf.test`);

    const plan = await app.inject({
      method: "POST",
      url: "/v1/platform/plans",
      headers: authed(platformAdminToken),
      payload: {
        code: "it-learning-apis-test",
        name: "IT Learning APIs Test",
        moduleEntitlements: { assessments: true, learning: true },
        limits: {},
      },
    });
    expect(plan.statusCode, plan.body).toBe(201);
    const assign = await app.inject({
      method: "POST",
      url: `/v1/platform/orgs/${orgId}/subscription`,
      headers: authed(platformAdminToken),
      payload: { planCode: "it-learning-apis-test" },
    });
    expect(assign.statusCode, assign.body).toBe(200);

    const adminId = await createActiveUser(`learning-admin-${RUN_ID}@it.cpf.test`);
    await addMembership(orgId, adminId, "org_admin");
    adminToken = await login(`learning-admin-${RUN_ID}@it.cpf.test`);

    const hmId = await createActiveUser(`learning-hm-${RUN_ID}@it.cpf.test`);
    await addMembership(orgId, hmId, "hiring_manager");
    hmToken = await login(`learning-hm-${RUN_ID}@it.cpf.test`);

    learnerUserId = await createActiveUser(`learning-learner-${RUN_ID}@it.cpf.test`);
    await addMembership(orgId, learnerUserId, "reviewer");
    learnerToken = await login(`learning-learner-${RUN_ID}@it.cpf.test`);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await closePool();
    await admin?.end();
  });

  it("blocks a hiring_manager (not learning_admin/org_admin) from authoring a course", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/learning/courses`,
      headers: authed(hmToken),
      payload: { title: "Should be blocked" },
    });
    expect(res.statusCode, res.body).toBe(403);
  });

  it("full author → publish → enrol → progress → complete journey", async () => {
    const course = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/learning/courses`,
      headers: authed(adminToken),
      payload: { title: "Intro to Structured Interviewing", description: "A short course." },
    });
    expect(course.statusCode, course.body).toBe(201);
    const courseId = course.json().id as string;

    const module = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/learning/courses/${courseId}/modules`,
      headers: authed(adminToken),
      payload: { title: "Module 1", position: 0 },
    });
    expect(module.statusCode, module.body).toBe(201);
    const moduleId = module.json().id as string;

    const lesson = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/learning/modules/${moduleId}/lessons`,
      headers: authed(adminToken),
      payload: {
        title: "Lesson 1",
        contentMarkdown: "# Welcome",
        position: 0,
        practiceTemplateCode: "SE1",
      },
    });
    expect(lesson.statusCode, lesson.body).toBe(201);
    const lessonId = lesson.json().id as string;

    // Cannot publish an empty-of-content course... this one has content, so
    // publish should succeed and freeze a checksum.
    const publish = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/learning/courses/${courseId}/publish`,
      headers: authed(adminToken),
    });
    expect(publish.statusCode, publish.body).toBe(200);
    expect(publish.json().status).toBe("published");
    expect(typeof publish.json().publishedChecksum).toBe("string");

    // Structure is now frozen: adding another module must be rejected.
    const lateModule = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/learning/courses/${courseId}/modules`,
      headers: authed(adminToken),
      payload: { title: "Too late", position: 1 },
    });
    expect(lateModule.statusCode, lateModule.body).toBe(409);
    expect(lateModule.json().error.code).toBe("COURSE_NOT_DRAFT");

    // Bulk-enrol the learner.
    const enrol = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/learning/enrollments`,
      headers: authed(adminToken),
      payload: { courseId, userIds: [learnerUserId], consentGiven: true },
    });
    expect(enrol.statusCode, enrol.body).toBe(201);
    expect(enrol.json()).toEqual({ enrolled: 1, skipped: 0 });

    const myEnrollments = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/learning/my-enrollments`,
      headers: authed(learnerToken),
    });
    expect(myEnrollments.statusCode, myEnrollments.body).toBe(200);
    const enrollments = myEnrollments.json() as Array<{ id: string; status: string; title: string }>;
    expect(enrollments).toHaveLength(1);
    expect(enrollments[0]!.status).toBe("enrolled");
    expect(enrollments[0]!.title).toBe("Intro to Structured Interviewing");
    const enrollmentId = enrollments[0]!.id;

    // Recording progress on the first lesson auto-begins the enrolment.
    const progress = await app.inject({
      method: "PUT",
      url: `/v1/orgs/${orgId}/learning/enrollments/${enrollmentId}/lessons/${lessonId}/progress`,
      headers: authed(learnerToken),
      payload: { completed: true },
    });
    expect(progress.statusCode, progress.body).toBe(200);

    const afterProgress = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/learning/my-enrollments`,
      headers: authed(learnerToken),
    });
    expect(afterProgress.json()[0].status).toBe("in_progress");

    // A different learner cannot touch this enrolment.
    const forbidden = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/learning/enrollments/${enrollmentId}/complete`,
      headers: authed(hmToken),
    });
    expect(forbidden.statusCode, forbidden.body).toBe(403);

    const complete = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/learning/enrollments/${enrollmentId}/complete`,
      headers: authed(learnerToken),
    });
    expect(complete.statusCode, complete.body).toBe(200);
    expect(complete.json().status).toBe("completed");

    // Terminal: completing again is a state conflict, not a silent no-op.
    const completeAgain = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/learning/enrollments/${enrollmentId}/complete`,
      headers: authed(learnerToken),
    });
    expect(completeAgain.statusCode, completeAgain.body).toBe(409);

    // --- Practice-assessment attempt: reuses the real scoring engine, but is
    // learning-only and must never touch hiring tables. ---
    const template = loadTemplate("SE1");
    const assessments = template.criteria.map((c) => ({ criterionId: c.id, reviewer1Score: 4 }));

    const reviewsBefore = await admin.query("SELECT count(*)::int AS n FROM reviews");
    const scoresBefore = await admin.query("SELECT count(*)::int AS n FROM criterion_scores");

    const attempt = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/learning/enrollments/${enrollmentId}/lessons/${lessonId}/practice-attempt`,
      headers: authed(learnerToken),
      payload: { assessments },
    });
    expect(attempt.statusCode, attempt.body).toBe(201);
    expect(attempt.json().profile).toBeTruthy();

    const reviewsAfter = await admin.query("SELECT count(*)::int AS n FROM reviews");
    const scoresAfter = await admin.query("SELECT count(*)::int AS n FROM criterion_scores");
    expect(reviewsAfter.rows[0].n).toBe(reviewsBefore.rows[0].n);
    expect(scoresAfter.rows[0].n).toBe(scoresBefore.rows[0].n);

    const stored = await admin.query(
      "SELECT organisation_id, enrollment_id, lesson_id, user_id, template_code FROM learning_assessment_attempts WHERE id = $1",
      [attempt.json().id],
    );
    expect(stored.rows[0]).toMatchObject({
      organisation_id: orgId,
      enrollment_id: enrollmentId,
      lesson_id: lessonId,
      user_id: learnerUserId,
      template_code: "SE1",
    });
  });

  it("pathway authoring: create pathway, link a course, bulk-enrol into the pathway", async () => {
    const course = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/learning/courses`,
      headers: authed(adminToken),
      payload: { title: "Pathway Course A" },
    });
    expect(course.statusCode, course.body).toBe(201);

    const pathway = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/learning/pathways`,
      headers: authed(adminToken),
      payload: { title: "New Manager Pathway" },
    });
    expect(pathway.statusCode, pathway.body).toBe(201);
    const pathwayId = pathway.json().id as string;

    const link = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/learning/pathways/${pathwayId}/courses`,
      headers: authed(adminToken),
      payload: { courseId: course.json().id, position: 0 },
    });
    expect(link.statusCode, link.body).toBe(201);

    const detail = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/learning/pathways/${pathwayId}`,
      headers: authed(adminToken),
    });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json().courses).toHaveLength(1);

    const secondLearner = await createActiveUser(`learning-learner-2-${RUN_ID}@it.cpf.test`);
    await addMembership(orgId, secondLearner, "reviewer");

    const enrol = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/learning/enrollments`,
      headers: authed(adminToken),
      payload: { pathwayId, userIds: [secondLearner] },
    });
    expect(enrol.statusCode, enrol.body).toBe(201);
    expect(enrol.json()).toEqual({ enrolled: 1, skipped: 0 });
  });

  it("an org without the learning module entitlement is blocked (403 MODULE_NOT_ENTITLED)", async () => {
    const bareOrgId = await createOrg(`it-learning-bare-${RUN_ID}`);
    const bareAdminId = await createActiveUser(`learning-bare-admin-${RUN_ID}@it.cpf.test`);
    await addMembership(bareOrgId, bareAdminId, "org_admin");
    const bareAdminToken = await login(`learning-bare-admin-${RUN_ID}@it.cpf.test`);

    const res = await app.inject({
      method: "POST",
      url: `/v1/orgs/${bareOrgId}/learning/courses`,
      headers: authed(bareAdminToken),
      payload: { title: "Should be blocked" },
    });
    expect(res.statusCode, res.body).toBe(403);
    expect(res.json().error.code).toBe("MODULE_NOT_ENTITLED");
  });
});
