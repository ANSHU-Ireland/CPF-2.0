import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  TEMPLATE_CODES,
  evaluate,
  learningEnrollmentMachine,
  loadScoringModel,
  loadTemplate,
  CriterionAssessmentSchema,
  type LearningEnrollmentState,
  type TemplateCode,
} from "@cpf/assessment-framework";
import { appendAudit } from "../../db/audit.js";
import { withOrgTx } from "../../db/pool.js";
import { requireModuleEntitlement, requireOrgRole, sendError } from "../auth/guards.js";

/**
 * Learning module APIs (Delivery Plan Step 41): course/pathway authoring,
 * bulk enrolment, learner progress, and an optional practice-assessment mode
 * that reuses the real scoring engine for the learner's own reference only.
 *
 * HARD RULE (carried over from Step 40's data model): nothing here ever
 * writes to or reads from candidates/invitations/assessment_sessions/
 * reviews/criterion_scores. `authz-matrix.test.ts` asserts every route below
 * is denied for every non-listed role; a dedicated test in
 * `learning.test.ts` additionally asserts a practice attempt never inserts
 * into any hiring table.
 */

const authorRoles = [
  requireOrgRole("org_admin", "learning_admin"),
  requireModuleEntitlement("learning"),
];

/** k-anonymity floor for the manager aggregate view (Step 42) — see route below. */
const MIN_ENROLLED_FOR_MANAGER_CELL = 5;
const learnerRoles = [
  requireOrgRole("org_admin", "hiring_manager", "reviewer", "learning_admin", "support_agent"),
  requireModuleEntitlement("learning"),
];

const CreateCourseSchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().max(10_000).default(""),
});

const CreateModuleSchema = z.object({
  title: z.string().min(1).max(200),
  position: z.number().int().min(0),
});

const CreateLessonSchema = z.object({
  title: z.string().min(1).max(200),
  contentMarkdown: z.string().max(50_000).default(""),
  position: z.number().int().min(0),
  practiceTemplateCode: z.enum(TEMPLATE_CODES).optional(),
});

const CreatePathwaySchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().max(10_000).default(""),
});

const AddPathwayCourseSchema = z.object({
  courseId: z.string().uuid(),
  position: z.number().int().min(0),
});

const BulkEnrolSchema = z.object({
  courseId: z.string().uuid().optional(),
  pathwayId: z.string().uuid().optional(),
  userIds: z.array(z.string().uuid()).min(1).max(500),
  consentGiven: z.boolean().default(false),
});

const LessonProgressSchema = z.object({
  completed: z.boolean(),
});

const PracticeAttemptSchema = z.object({
  assessments: z.array(CriterionAssessmentSchema),
});

function computeCourseChecksum(modules: Array<{ title: string; lessons: Array<{ title: string; contentMarkdown: string }> }>): string {
  return createHash("sha256").update(JSON.stringify(modules)).digest("hex");
}

export function registerLearningRoutes(app: FastifyInstance): void {
  // Retained from Step 36's placeholder — cheap, uncontroversial module-gate
  // smoke check that `entitlements.test.ts`/`authz-matrix.test.ts` already
  // depend on; the real feature routes below reuse the same gate shape.
  app.get(
    "/v1/orgs/:orgId/learning/status",
    { preHandler: [requireOrgRole("org_admin", "hiring_manager", "learning_admin"), requireModuleEntitlement("learning")] },
    async () => {
      return { module: "learning", enabled: true };
    },
  );

  // -------------------------------------------------------------- courses ----
  app.post("/v1/orgs/:orgId/learning/courses", { preHandler: authorRoles }, async (request, reply) => {
    const parsed = CreateCourseSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Invalid course.", request.id);
    }
    const orgId = request.orgId!;
    const auth = request.auth!;
    const row = await withOrgTx(orgId, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO courses (organisation_id, title, description) VALUES ($1, $2, $3) RETURNING id`,
        [orgId, parsed.data.title, parsed.data.description],
      );
      await appendAudit(client, {
        organisationId: orgId,
        actorUserId: auth.userId,
        action: "learning.course_created",
        entityType: "course",
        entityId: result.rows[0]!.id,
      });
      return result.rows[0]!;
    });
    return reply.status(201).send({ id: row.id });
  });

  app.get("/v1/orgs/:orgId/learning/courses", { preHandler: authorRoles }, async (request) => {
    const orgId = request.orgId!;
    return withOrgTx(orgId, async (client) => {
      const rows = await client.query(
        `SELECT id, title, status, published_at, created_at FROM courses ORDER BY created_at DESC LIMIT 200`,
      );
      return rows.rows;
    });
  });

  app.get<{ Params: { courseId: string } }>(
    "/v1/orgs/:orgId/learning/courses/:courseId",
    { preHandler: authorRoles },
    async (request, reply) => {
      const orgId = request.orgId!;
      const { courseId } = request.params;
      const result = await withOrgTx(orgId, async (client) => {
        const course = await client.query(
          `SELECT id, title, description, status, published_checksum, published_at FROM courses WHERE id = $1`,
          [courseId],
        );
        if (!course.rows[0]) return null;
        const modules = await client.query(
          `SELECT id, title, position FROM course_modules WHERE course_id = $1 ORDER BY position`,
          [courseId],
        );
        const lessons = await client.query(
          `SELECT l.id, l.course_module_id, l.title, l.content_markdown, l.position, l.practice_template_code
             FROM lessons l JOIN course_modules m ON m.id = l.course_module_id
            WHERE m.course_id = $1 ORDER BY l.position`,
          [courseId],
        );
        return {
          ...course.rows[0],
          modules: modules.rows.map((m) => ({
            ...m,
            lessons: lessons.rows.filter((l) => l.course_module_id === m.id),
          })),
        };
      });
      if (!result) return sendError(reply, 404, "NOT_FOUND", "Course not found.", request.id);
      return result;
    },
  );

  app.post<{ Params: { courseId: string } }>(
    "/v1/orgs/:orgId/learning/courses/:courseId/modules",
    { preHandler: authorRoles },
    async (request, reply) => {
      const parsed = CreateModuleSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Invalid module.", request.id);
      }
      const orgId = request.orgId!;
      const { courseId } = request.params;
      try {
        const row = await withOrgTx(orgId, async (client) => {
          const course = await client.query("SELECT status FROM courses WHERE id = $1", [courseId]);
          if (!course.rows[0]) return { notFound: true as const };
          if (course.rows[0].status !== "draft") {
            return { locked: true as const };
          }
          const result = await client.query<{ id: string }>(
            `INSERT INTO course_modules (organisation_id, course_id, title, position) VALUES ($1, $2, $3, $4) RETURNING id`,
            [orgId, courseId, parsed.data.title, parsed.data.position],
          );
          return { id: result.rows[0]!.id };
        });
        if ("notFound" in row) return sendError(reply, 404, "NOT_FOUND", "Course not found.", request.id);
        if ("locked" in row) {
          return sendError(reply, 409, "COURSE_NOT_DRAFT", "A published or archived course's structure cannot be edited.", request.id);
        }
        return reply.status(201).send({ id: row.id });
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          return sendError(reply, 409, "DUPLICATE_POSITION", "A module already occupies this position.", request.id);
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { moduleId: string } }>(
    "/v1/orgs/:orgId/learning/modules/:moduleId/lessons",
    { preHandler: authorRoles },
    async (request, reply) => {
      const parsed = CreateLessonSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Invalid lesson.", request.id);
      }
      const orgId = request.orgId!;
      const { moduleId } = request.params;
      try {
        const row = await withOrgTx(orgId, async (client) => {
          const mod = await client.query(
            `SELECT c.status FROM course_modules m JOIN courses c ON c.id = m.course_id WHERE m.id = $1`,
            [moduleId],
          );
          if (!mod.rows[0]) return { notFound: true as const };
          if (mod.rows[0].status !== "draft") return { locked: true as const };
          const result = await client.query<{ id: string }>(
            `INSERT INTO lessons (organisation_id, course_module_id, title, content_markdown, position, practice_template_code)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [
              orgId,
              moduleId,
              parsed.data.title,
              parsed.data.contentMarkdown,
              parsed.data.position,
              parsed.data.practiceTemplateCode ?? null,
            ],
          );
          return { id: result.rows[0]!.id };
        });
        if ("notFound" in row) return sendError(reply, 404, "NOT_FOUND", "Module not found.", request.id);
        if ("locked" in row) {
          return sendError(reply, 409, "COURSE_NOT_DRAFT", "A published or archived course's structure cannot be edited.", request.id);
        }
        return reply.status(201).send({ id: row.id });
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          return sendError(reply, 409, "DUPLICATE_POSITION", "A lesson already occupies this position.", request.id);
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { courseId: string } }>(
    "/v1/orgs/:orgId/learning/courses/:courseId/publish",
    { preHandler: authorRoles },
    async (request, reply) => {
      const orgId = request.orgId!;
      const auth = request.auth!;
      const { courseId } = request.params;
      const outcome = await withOrgTx(orgId, async (client) => {
        const course = await client.query("SELECT status FROM courses WHERE id = $1", [courseId]);
        if (!course.rows[0]) return { status: 404, body: { error: "NOT_FOUND" } };
        if (course.rows[0].status !== "draft") {
          return { status: 409, body: { error: "COURSE_NOT_DRAFT" } };
        }
        const modules = await client.query(
          `SELECT id, title FROM course_modules WHERE course_id = $1 ORDER BY position`,
          [courseId],
        );
        if (modules.rows.length === 0) {
          return { status: 422, body: { error: "COURSE_EMPTY", message: "A course needs at least one module before it can be published." } };
        }
        const lessons = await client.query(
          `SELECT course_module_id, title, content_markdown FROM lessons WHERE course_module_id = ANY($1) ORDER BY position`,
          [modules.rows.map((m) => m.id)],
        );
        if (lessons.rows.length === 0) {
          return { status: 422, body: { error: "COURSE_EMPTY", message: "A course needs at least one lesson before it can be published." } };
        }
        // Freeze content: sha256 of the current module/lesson content, so a
        // learner's completion record can always be traced to what they
        // actually saw, even if the course is edited again afterwards.
        const checksum = computeCourseChecksum(
          modules.rows.map((m) => ({
            title: m.title,
            lessons: lessons.rows
              .filter((l) => l.course_module_id === m.id)
              .map((l) => ({ title: l.title, contentMarkdown: l.content_markdown })),
          })),
        );
        await client.query(
          `UPDATE courses SET status = 'published', published_checksum = $2, published_at = now(), updated_at = now() WHERE id = $1`,
          [courseId, checksum],
        );
        await appendAudit(client, {
          organisationId: orgId,
          actorUserId: auth.userId,
          action: "learning.course_published",
          entityType: "course",
          entityId: courseId,
          metadata: { checksum },
        });
        return { status: 200, body: { status: "published", publishedChecksum: checksum } };
      });
      return reply.status(outcome.status).send(outcome.body);
    },
  );

  // ------------------------------------------------------------- pathways ----
  app.post("/v1/orgs/:orgId/learning/pathways", { preHandler: authorRoles }, async (request, reply) => {
    const parsed = CreatePathwaySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Invalid pathway.", request.id);
    }
    const orgId = request.orgId!;
    const auth = request.auth!;
    const row = await withOrgTx(orgId, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO pathways (organisation_id, title, description) VALUES ($1, $2, $3) RETURNING id`,
        [orgId, parsed.data.title, parsed.data.description],
      );
      await appendAudit(client, {
        organisationId: orgId,
        actorUserId: auth.userId,
        action: "learning.pathway_created",
        entityType: "pathway",
        entityId: result.rows[0]!.id,
      });
      return result.rows[0]!;
    });
    return reply.status(201).send({ id: row.id });
  });

  app.get("/v1/orgs/:orgId/learning/pathways", { preHandler: authorRoles }, async (request) => {
    const orgId = request.orgId!;
    return withOrgTx(orgId, async (client) => {
      const rows = await client.query(
        `SELECT id, title, status, created_at FROM pathways ORDER BY created_at DESC LIMIT 200`,
      );
      return rows.rows;
    });
  });

  app.get<{ Params: { pathwayId: string } }>(
    "/v1/orgs/:orgId/learning/pathways/:pathwayId",
    { preHandler: authorRoles },
    async (request, reply) => {
      const orgId = request.orgId!;
      const { pathwayId } = request.params;
      const result = await withOrgTx(orgId, async (client) => {
        const pathway = await client.query(
          `SELECT id, title, description, status FROM pathways WHERE id = $1`,
          [pathwayId],
        );
        if (!pathway.rows[0]) return null;
        const courses = await client.query(
          `SELECT pc.position, c.id, c.title, c.status
             FROM pathway_courses pc JOIN courses c ON c.id = pc.course_id
            WHERE pc.pathway_id = $1 ORDER BY pc.position`,
          [pathwayId],
        );
        return { ...pathway.rows[0], courses: courses.rows };
      });
      if (!result) return sendError(reply, 404, "NOT_FOUND", "Pathway not found.", request.id);
      return result;
    },
  );

  app.post<{ Params: { pathwayId: string } }>(
    "/v1/orgs/:orgId/learning/pathways/:pathwayId/courses",
    { preHandler: authorRoles },
    async (request, reply) => {
      const parsed = AddPathwayCourseSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Invalid pathway course link.", request.id);
      }
      const orgId = request.orgId!;
      const { pathwayId } = request.params;
      try {
        const outcome = await withOrgTx(orgId, async (client) => {
          const pathway = await client.query("SELECT id FROM pathways WHERE id = $1", [pathwayId]);
          if (!pathway.rows[0]) return { status: 404, body: { error: "NOT_FOUND" } };
          const course = await client.query("SELECT id FROM courses WHERE id = $1", [parsed.data.courseId]);
          if (!course.rows[0]) return { status: 404, body: { error: "COURSE_NOT_FOUND" } };
          const result = await client.query<{ id: string }>(
            `INSERT INTO pathway_courses (organisation_id, pathway_id, course_id, position) VALUES ($1, $2, $3, $4) RETURNING id`,
            [orgId, pathwayId, parsed.data.courseId, parsed.data.position],
          );
          return { status: 201, body: { id: result.rows[0]!.id } };
        });
        return reply.status(outcome.status).send(outcome.body);
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          return sendError(reply, 409, "DUPLICATE_PATHWAY_COURSE", "This course already occupies that position, or is already linked to this pathway.", request.id);
        }
        throw error;
      }
    },
  );

  // ----------------------------------------------------------- enrolments ----
  app.post("/v1/orgs/:orgId/learning/enrollments", { preHandler: authorRoles }, async (request, reply) => {
    const parsed = BulkEnrolSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Invalid enrolment request.", request.id);
    }
    const { courseId, pathwayId, userIds, consentGiven } = parsed.data;
    if ((courseId && pathwayId) || (!courseId && !pathwayId)) {
      return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Specify exactly one of courseId or pathwayId.", request.id);
    }
    const orgId = request.orgId!;
    const auth = request.auth!;
    const result = await withOrgTx(orgId, async (client) => {
      let enrolled = 0;
      let skipped = 0;
      for (const userId of userIds) {
        const member = await client.query(
          "SELECT 1 FROM org_memberships WHERE organisation_id = $1 AND user_id = $2 LIMIT 1",
          [orgId, userId],
        );
        if (!member.rows[0]) {
          skipped++;
          continue;
        }
        const inserted = await client.query(
          `INSERT INTO learning_enrollments (organisation_id, user_id, course_id, pathway_id, consent_given_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT DO NOTHING RETURNING id`,
          [orgId, userId, courseId ?? null, pathwayId ?? null, consentGiven ? new Date() : null],
        );
        if (inserted.rows[0]) enrolled++;
        else skipped++;
      }
      await appendAudit(client, {
        organisationId: orgId,
        actorUserId: auth.userId,
        action: "learning.bulk_enrolled",
        entityType: courseId ? "course" : "pathway",
        entityId: (courseId ?? pathwayId)!,
        metadata: { enrolled, skipped, requested: userIds.length },
      });
      return { enrolled, skipped };
    });
    return reply.status(201).send(result);
  });

  app.get("/v1/orgs/:orgId/learning/my-enrollments", { preHandler: learnerRoles }, async (request) => {
    const orgId = request.orgId!;
    const userId = request.auth!.userId;
    return withOrgTx(orgId, async (client) => {
      const rows = await client.query(
        `SELECT e.id, e.status, e.course_id, e.pathway_id, e.started_at, e.completed_at,
                COALESCE(c.title, p.title) AS title
           FROM learning_enrollments e
           LEFT JOIN courses c ON c.id = e.course_id
           LEFT JOIN pathways p ON p.id = e.pathway_id
          WHERE e.user_id = $1
          ORDER BY e.created_at DESC`,
        [userId],
      );
      return rows.rows;
    });
  });

  // Enrolment detail: powers LearnerHomePage's detail view and
  // LessonPlayerPage. Course-based enrolments get full module/lesson content
  // (with this enrolment's own per-lesson completion flag joined in);
  // pathway-based enrolments get only the linked-course list — the same v1
  // scope limitation already disclosed for practice-attempt (no lesson-level
  // player for pathways yet).
  app.get<{ Params: { enrollmentId: string } }>(
    "/v1/orgs/:orgId/learning/enrollments/:enrollmentId",
    { preHandler: learnerRoles },
    async (request, reply) => {
      const orgId = request.orgId!;
      const userId = request.auth!.userId;
      const { enrollmentId } = request.params;
      const result = await withOrgTx(orgId, async (client) => {
        const enrollment = await client.query<{
          id: string;
          user_id: string;
          status: string;
          course_id: string | null;
          pathway_id: string | null;
          started_at: string | null;
          completed_at: string | null;
        }>(
          "SELECT id, user_id, status, course_id, pathway_id, started_at, completed_at FROM learning_enrollments WHERE id = $1",
          [enrollmentId],
        );
        if (!enrollment.rows[0]) return { notFound: true as const };
        if (enrollment.rows[0].user_id !== userId) return { forbidden: true as const };
        const e = enrollment.rows[0];
        let course: unknown = null;
        let pathway: unknown = null;
        if (e.course_id) {
          const courseRow = await client.query(
            `SELECT id, title, status FROM courses WHERE id = $1`,
            [e.course_id],
          );
          const modules = await client.query(
            `SELECT id, title, position FROM course_modules WHERE course_id = $1 ORDER BY position`,
            [e.course_id],
          );
          const lessons = await client.query(
            `SELECT l.id, l.course_module_id, l.title, l.position, l.practice_template_code,
                    (p.completed_at IS NOT NULL) AS completed
               FROM lessons l
               JOIN course_modules m ON m.id = l.course_module_id
               LEFT JOIN lesson_progress p ON p.lesson_id = l.id AND p.enrollment_id = $2
              WHERE m.course_id = $1
              ORDER BY l.position`,
            [e.course_id, enrollmentId],
          );
          course = {
            ...courseRow.rows[0],
            modules: modules.rows.map((m) => ({
              ...m,
              lessons: lessons.rows.filter((l) => l.course_module_id === m.id),
            })),
          };
        } else if (e.pathway_id) {
          const pathwayRow = await client.query(
            `SELECT id, title, status FROM pathways WHERE id = $1`,
            [e.pathway_id],
          );
          const courses = await client.query(
            `SELECT pc.position, c.id, c.title, c.status
               FROM pathway_courses pc JOIN courses c ON c.id = pc.course_id
              WHERE pc.pathway_id = $1 ORDER BY pc.position`,
            [e.pathway_id],
          );
          pathway = { ...pathwayRow.rows[0], courses: courses.rows };
        }
        return {
          id: e.id,
          status: e.status,
          startedAt: e.started_at,
          completedAt: e.completed_at,
          course,
          pathway,
        };
      });
      if ("notFound" in result) return sendError(reply, 404, "NOT_FOUND", "Enrolment not found.", request.id);
      if ("forbidden" in result) return sendError(reply, 403, "FORBIDDEN", "This is not your enrolment.", request.id);
      return result;
    },
  );

  // Learner's own skills profile (Step 42): completed courses/pathways plus
  // their own most recent practice-attempt evidence profiles — self-view
  // only, built entirely from this user's own rows.
  app.get("/v1/orgs/:orgId/learning/my-skills-profile", { preHandler: learnerRoles }, async (request) => {
    const orgId = request.orgId!;
    const userId = request.auth!.userId;
    return withOrgTx(orgId, async (client) => {
      const completedCourses = await client.query(
        `SELECT c.id, c.title, e.completed_at
           FROM learning_enrollments e JOIN courses c ON c.id = e.course_id
          WHERE e.user_id = $1 AND e.status = 'completed'
          ORDER BY e.completed_at DESC`,
        [userId],
      );
      const completedPathways = await client.query(
        `SELECT p.id, p.title, e.completed_at
           FROM learning_enrollments e JOIN pathways p ON p.id = e.pathway_id
          WHERE e.user_id = $1 AND e.status = 'completed'
          ORDER BY e.completed_at DESC`,
        [userId],
      );
      const practiceAttempts = await client.query(
        `SELECT DISTINCT ON (template_code) id, template_code, profile, created_at
           FROM learning_assessment_attempts
          WHERE user_id = $1
          ORDER BY template_code, created_at DESC`,
        [userId],
      );
      return {
        completedCourses: completedCourses.rows,
        completedPathways: completedPathways.rows,
        practiceAttempts: practiceAttempts.rows,
      };
    });
  });

  // Manager aggregate view (Step 42): completion counts per course, org-wide.
  // SCOPE NOTE: the delivery plan calls this "by team", but the schema has
  // no team/reporting-line concept (org_memberships is flat org+role) — this
  // aggregates by COURSE across the whole organisation instead, an explicit,
  // disclosed scope reduction rather than inventing a team hierarchy this
  // step didn't budget for. k-anonymity floor still applies: a course's row
  // is suppressed unless at least MIN_ENROLLED_FOR_MANAGER_CELL learners are
  // enrolled in it, so no cell can ever reveal a single learner's standing.
  app.get("/v1/orgs/:orgId/learning/manager-view", { preHandler: authorRoles }, async (request) => {
    const orgId = request.orgId!;
    return withOrgTx(orgId, async (client) => {
      const rows = await client.query<{
        course_id: string;
        title: string;
        enrolled_count: number;
        completed_count: number;
      }>(
        `SELECT c.id AS course_id, c.title,
                count(e.id)::int AS enrolled_count,
                count(e.id) FILTER (WHERE e.status = 'completed')::int AS completed_count
           FROM courses c
           LEFT JOIN learning_enrollments e ON e.course_id = c.id
          WHERE c.organisation_id = $1
          GROUP BY c.id, c.title
          ORDER BY c.title`,
        [orgId],
      );
      const courses = rows.rows.map((r) => {
        const suppressed = r.enrolled_count < MIN_ENROLLED_FOR_MANAGER_CELL;
        return {
          courseId: r.course_id,
          title: r.title,
          suppressed,
          enrolledCount: suppressed ? null : r.enrolled_count,
          completedCount: suppressed ? null : r.completed_count,
          completionRate: suppressed || r.enrolled_count === 0 ? null : r.completed_count / r.enrolled_count,
        };
      });
      return {
        courses,
        suppressionNote: `A course's completion figures are shown only once at least ${MIN_ENROLLED_FOR_MANAGER_CELL} learners are enrolled in it, so no cell can reveal a single learner's standing.`,
      };
    });
  });

  app.put<{ Params: { enrollmentId: string; lessonId: string } }>(
    "/v1/orgs/:orgId/learning/enrollments/:enrollmentId/lessons/:lessonId/progress",
    { preHandler: learnerRoles },
    async (request, reply) => {
      const parsed = LessonProgressSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Invalid progress payload.", request.id);
      }
      const orgId = request.orgId!;
      const userId = request.auth!.userId;
      const { enrollmentId, lessonId } = request.params;
      const outcome = await withOrgTx(orgId, async (client) => {
        const enrollment = await client.query<{ user_id: string; status: string; course_id: string | null }>(
          "SELECT user_id, status, course_id FROM learning_enrollments WHERE id = $1",
          [enrollmentId],
        );
        if (!enrollment.rows[0]) return { status: 404, body: { error: "NOT_FOUND" } };
        if (enrollment.rows[0].user_id !== userId) {
          return { status: 403, body: { error: "FORBIDDEN", message: "This is not your enrolment." } };
        }
        if (learningEnrollmentMachine.isTerminal(enrollment.rows[0].status as LearningEnrollmentState)) {
          return { status: 409, body: { error: "ENROLLMENT_TERMINAL" } };
        }
        await client.query(
          `INSERT INTO lesson_progress (organisation_id, enrollment_id, lesson_id, completed_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (enrollment_id, lesson_id) DO UPDATE SET completed_at = EXCLUDED.completed_at, updated_at = now()`,
          [orgId, enrollmentId, lessonId, parsed.data.completed ? new Date() : null],
        );
        if (enrollment.rows[0].status === "enrolled") {
          const next = learningEnrollmentMachine.next("enrolled", "begin");
          await client.query(
            "UPDATE learning_enrollments SET status = $2, started_at = now() WHERE id = $1",
            [enrollmentId, next],
          );
        }
        return { status: 200, body: { ok: true } };
      });
      return reply.status(outcome.status).send(outcome.body);
    },
  );

  app.post<{ Params: { enrollmentId: string } }>(
    "/v1/orgs/:orgId/learning/enrollments/:enrollmentId/complete",
    { preHandler: learnerRoles },
    async (request, reply) => {
      const orgId = request.orgId!;
      const auth = request.auth!;
      const { enrollmentId } = request.params;
      const outcome = await withOrgTx(orgId, async (client) => {
        const enrollment = await client.query<{ user_id: string; status: string }>(
          "SELECT user_id, status FROM learning_enrollments WHERE id = $1",
          [enrollmentId],
        );
        if (!enrollment.rows[0]) return { status: 404, body: { error: "NOT_FOUND" } };
        if (enrollment.rows[0].user_id !== auth.userId) {
          return { status: 403, body: { error: "FORBIDDEN", message: "This is not your enrolment." } };
        }
        let next: LearningEnrollmentState;
        try {
          next = learningEnrollmentMachine.next(enrollment.rows[0].status as LearningEnrollmentState, "complete");
        } catch {
          return { status: 409, body: { error: "STATE_CONFLICT", message: `Cannot complete an enrolment in state "${enrollment.rows[0].status}".` } };
        }
        await client.query(
          "UPDATE learning_enrollments SET status = $2, completed_at = now() WHERE id = $1",
          [enrollmentId, next],
        );
        await appendAudit(client, {
          organisationId: orgId,
          actorUserId: auth.userId,
          action: "learning.enrollment_completed",
          entityType: "learning_enrollment",
          entityId: enrollmentId,
        });
        return { status: 200, body: { status: next } };
      });
      return reply.status(outcome.status).send(outcome.body);
    },
  );

  // ---------------------------------------------------- practice mode ----
  app.post<{ Params: { enrollmentId: string; lessonId: string } }>(
    "/v1/orgs/:orgId/learning/enrollments/:enrollmentId/lessons/:lessonId/practice-attempt",
    { preHandler: learnerRoles },
    async (request, reply) => {
      const parsed = PracticeAttemptSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Invalid practice attempt.", request.id);
      }
      const orgId = request.orgId!;
      const auth = request.auth!;
      const { enrollmentId, lessonId } = request.params;
      const outcome = await withOrgTx(orgId, async (client) => {
        const enrollment = await client.query<{ user_id: string; course_id: string | null }>(
          "SELECT user_id, course_id FROM learning_enrollments WHERE id = $1",
          [enrollmentId],
        );
        if (!enrollment.rows[0]) return { status: 404, body: { error: "NOT_FOUND" } };
        if (enrollment.rows[0].user_id !== auth.userId) {
          return { status: 403, body: { error: "FORBIDDEN", message: "This is not your enrolment." } };
        }
        if (!enrollment.rows[0].course_id) {
          // Honest scope boundary (v1): practice mode is only wired up for
          // course-based enrolments, not pathway-based ones, yet.
          return { status: 422, body: { error: "UNSUPPORTED_ENROLLMENT_TYPE", message: "Practice mode is not yet supported for pathway enrolments." } };
        }
        const lesson = await client.query<{ practice_template_code: string | null; course_module_id: string }>(
          `SELECT l.practice_template_code, l.course_module_id FROM lessons l
             JOIN course_modules m ON m.id = l.course_module_id
            WHERE l.id = $1 AND m.course_id = $2`,
          [lessonId, enrollment.rows[0].course_id],
        );
        if (!lesson.rows[0]) return { status: 404, body: { error: "LESSON_NOT_FOUND" } };
        const templateCode = lesson.rows[0].practice_template_code;
        if (!templateCode) {
          return { status: 422, body: { error: "NO_PRACTICE_TEMPLATE", message: "This lesson has no practice-mode template linked." } };
        }
        const profile = evaluate(
          loadTemplate(templateCode as TemplateCode),
          loadScoringModel(),
          parsed.data.assessments,
        );
        const attempt = await client.query<{ id: string }>(
          `INSERT INTO learning_assessment_attempts (organisation_id, enrollment_id, lesson_id, user_id, template_code, input, profile)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [orgId, enrollmentId, lessonId, auth.userId, templateCode, JSON.stringify(parsed.data.assessments), JSON.stringify(profile)],
        );
        return { status: 201, body: { id: attempt.rows[0]!.id, profile } };
      });
      return reply.status(outcome.status).send(outcome.body);
    },
  );
}

