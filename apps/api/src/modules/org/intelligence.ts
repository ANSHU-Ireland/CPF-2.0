import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { appendAudit } from "../../db/audit.js";
import { withOrgTx } from "../../db/pool.js";
import { requireModuleEntitlement, requireOrgRole, sendError } from "../auth/guards.js";

/**
 * Workforce Intelligence backend (Delivery Plan Step 43, Phase 5).
 *
 * HARD ANTI-SURVEILLANCE RULE, enforced structurally, not just by convention:
 * every read endpoint below returns AGGREGATE counts only, gated by a
 * k-anonymity floor (MIN_COHORT_FOR_CELL) — there is no endpoint anywhere in
 * this file, and there must never be one added later, that returns a single
 * employee's identifiable learning/pain-point/adoption data. Pain-point
 * submission additionally supports a genuinely anonymous option
 * (`submitted_by` stored as NULL, never a caller-derived placeholder).
 * `intelligence.test.ts` asserts this by inspecting response bodies for any
 * user-identifying field, not just by code review.
 *
 * Two independent gates apply to every route: (1) `requireModuleEntitlement
 * ("intelligence")` — the org's plan must include this module (defaults to
 * false per Step 36's DEFAULT_MODULE_ENTITLEMENTS, same as "learning"); (2)
 * `requireIntelligenceEnabled` — the org must have additionally opted in via
 * PUT .../intelligence/settings, which requires a fresh works-council/
 * employee-representative acknowledgement on every enable transition. The
 * settings endpoints themselves are exempt from gate (2) (an org must be able
 * to view/enable the feature while it's still disabled).
 *
 * SCOPE REDUCTIONS, disclosed honestly rather than silently invented:
 * - "AI-adoption (from learning ai-literacy tags)": no "ai-literacy tag"
 *   concept exists anywhere in the schema (courses/lessons carry no such
 *   field). Reinterpreted as a practice-attempt participation rate (the
 *   fraction of a course's enrolled learners who have made at least one
 *   `learning_assessment_attempts` row) — a real, honestly-labelled proxy for
 *   engagement with the AI-assisted practice-scoring feature, not a
 *   fabrication of the literal plan text.
 * - "Token-cost placeholder (reads model_invocations)": that table does not
 *   exist yet — it belongs to the not-yet-built Step 45 AI gateway. Returns
 *   an explicit `{available: false, reason}` structural placeholder instead
 *   of querying a table that doesn't exist or fabricating numbers.
 */

const MIN_COHORT_FOR_CELL = 8;
const SUPPRESSED = null; // explicit marker: "fewer than MIN_COHORT_FOR_CELL — not shown", never a fabricated 0.

const adminRoles = [requireOrgRole("org_admin"), requireModuleEntitlement("intelligence")];
const anyOrgRole = [
  requireOrgRole("org_admin", "hiring_manager", "reviewer", "learning_admin", "support_agent"),
  requireModuleEntitlement("intelligence"),
];

/**
 * Gates a route on the organisation having actually opted in (distinct from
 * merely being plan-entitled to the module). Must run after requireOrgRole
 * (needs request.orgId).
 */
async function requireIntelligenceEnabled(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const orgId = request.orgId!;
  const enabled = await withOrgTx(orgId, async (client) => {
    const result = await client.query<{ enabled: boolean }>(
      "SELECT enabled FROM org_intelligence_settings WHERE organisation_id = $1",
      [orgId],
    );
    return result.rows[0]?.enabled ?? false;
  });
  if (!enabled) {
    await sendError(
      reply,
      403,
      "INTELLIGENCE_NOT_ENABLED",
      "Workforce Intelligence is not enabled for this organisation. An org administrator must enable it (requires a works-council/employee-representative acknowledgement) first.",
      request.id,
    );
  }
}

const UpdateSettingsSchema = z.object({
  enabled: z.boolean(),
  worksCouncilAcknowledgedBy: z.string().min(2).max(200).optional(),
});

const SubmitPainPointSchema = z.object({
  category: z.enum(["workload", "tooling", "process", "management", "other"]),
  reportText: z.string().min(1).max(5000),
  anonymous: z.boolean().default(false),
});

export function registerIntelligenceRoutes(app: FastifyInstance): void {
  app.get("/v1/orgs/:orgId/intelligence/settings", { preHandler: adminRoles }, async (request) => {
    const orgId = request.orgId!;
    return withOrgTx(orgId, async (client) => {
      const result = await client.query<{
        enabled: boolean;
        works_council_acknowledged_by: string | null;
        works_council_acknowledged_at: Date | null;
        enabled_at: Date | null;
      }>(
        `SELECT enabled, works_council_acknowledged_by, works_council_acknowledged_at, enabled_at
           FROM org_intelligence_settings WHERE organisation_id = $1`,
        [orgId],
      );
      const row = result.rows[0];
      return {
        enabled: row?.enabled ?? false,
        worksCouncilAcknowledgedBy: row?.works_council_acknowledged_by ?? null,
        worksCouncilAcknowledgedAt: row?.works_council_acknowledged_at ?? null,
        enabledAt: row?.enabled_at ?? null,
      };
    });
  });

  app.put("/v1/orgs/:orgId/intelligence/settings", { preHandler: adminRoles }, async (request, reply) => {
    const parsed = UpdateSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Invalid settings payload.", request.id);
    }
    const { enabled, worksCouncilAcknowledgedBy } = parsed.data;
    if (enabled && !worksCouncilAcknowledgedBy) {
      return sendError(
        reply,
        422,
        "WORKS_COUNCIL_ACK_REQUIRED",
        "Enabling Workforce Intelligence requires a fresh works-council / employee-representative acknowledgement (name).",
        request.id,
      );
    }
    const orgId = request.orgId!;
    const userId = request.auth!.userId;
    await withOrgTx(orgId, async (client) => {
      if (enabled) {
        await client.query(
          `INSERT INTO org_intelligence_settings
             (organisation_id, enabled, works_council_acknowledged_by, works_council_acknowledged_at, enabled_by_user_id, enabled_at, updated_at)
           VALUES ($1, true, $2, now(), $3, now(), now())
           ON CONFLICT (organisation_id) DO UPDATE SET
             enabled = true,
             works_council_acknowledged_by = EXCLUDED.works_council_acknowledged_by,
             works_council_acknowledged_at = now(),
             enabled_by_user_id = EXCLUDED.enabled_by_user_id,
             enabled_at = now(),
             updated_at = now()`,
          [orgId, worksCouncilAcknowledgedBy, userId],
        );
      } else {
        await client.query(
          `INSERT INTO org_intelligence_settings (organisation_id, enabled, updated_at)
           VALUES ($1, false, now())
           ON CONFLICT (organisation_id) DO UPDATE SET enabled = false, updated_at = now()`,
          [orgId],
        );
      }
      await appendAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: enabled ? "intelligence.enabled" : "intelligence.disabled",
        entityType: "org_intelligence_settings",
        entityId: orgId,
        metadata: enabled ? { worksCouncilAcknowledgedBy } : {},
      });
    });
    return reply.status(200).send({ enabled });
  });

  app.post(
    "/v1/orgs/:orgId/pain-points",
    { preHandler: [...anyOrgRole, requireIntelligenceEnabled] },
    async (request, reply) => {
      const parsed = SubmitPainPointSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Invalid pain-point report.", request.id);
      }
      const { category, reportText, anonymous } = parsed.data;
      const orgId = request.orgId!;
      const submittedBy = anonymous ? null : request.auth!.userId;
      const id = await withOrgTx(orgId, async (client) => {
        const result = await client.query<{ id: string }>(
          `INSERT INTO pain_point_reports (organisation_id, submitted_by, category, report_text)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [orgId, submittedBy, category, reportText],
        );
        // Anonymous submissions are audited without an actor id — logging the
        // real submitter here would defeat the anonymity option entirely.
        // The report text itself is never included in audit metadata either.
        await appendAudit(client, {
          organisationId: orgId,
          actorUserId: submittedBy,
          action: "intelligence.pain_point_submitted",
          entityType: "pain_point_report",
          entityId: result.rows[0]!.id,
          metadata: { category, anonymous },
        });
        return result.rows[0]!.id;
      });
      return reply.status(201).send({ id });
    },
  );

  app.get(
    "/v1/orgs/:orgId/intelligence/pain-point-themes",
    { preHandler: [...adminRoles, requireIntelligenceEnabled] },
    async (request) => {
      const orgId = request.orgId!;
      return withOrgTx(orgId, async (client) => {
        const rows = await client.query<{ category: string; count: number }>(
          `SELECT category::text AS category, count(*)::int AS count
             FROM pain_point_reports WHERE organisation_id = $1 GROUP BY category`,
          [orgId],
        );
        const counts = new Map(rows.rows.map((r) => [r.category, r.count]));
        const categories = ["workload", "tooling", "process", "management", "other"] as const;
        return {
          themes: categories.map((category) => {
            const count = counts.get(category) ?? 0;
            const suppressed = count < MIN_COHORT_FOR_CELL;
            return { category, suppressed, count: suppressed ? SUPPRESSED : count };
          }),
          suppressionNote: `Per-category counts are suppressed ("null", not zero) below a cohort of ${MIN_COHORT_FOR_CELL} reports — never a per-employee breakdown, and never linkable to who submitted anonymously vs. by name.`,
        };
      });
    },
  );

  app.get(
    "/v1/orgs/:orgId/intelligence/skills-gap",
    { preHandler: [...adminRoles, requireIntelligenceEnabled] },
    async (request) => {
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
            WHERE c.organisation_id = $1 AND c.status = 'published'
            GROUP BY c.id, c.title
            ORDER BY c.title`,
          [orgId],
        );
        return {
          courses: rows.rows.map((r) => {
            const suppressed = r.enrolled_count < MIN_COHORT_FOR_CELL;
            return {
              courseId: r.course_id,
              title: r.title,
              suppressed,
              enrolledCount: suppressed ? SUPPRESSED : r.enrolled_count,
              completedCount: suppressed ? SUPPRESSED : r.completed_count,
              completionRate: suppressed || r.enrolled_count === 0
                ? SUPPRESSED
                : Math.round((r.completed_count / r.enrolled_count) * 1000) / 1000,
            };
          }),
          suppressionNote: `A course's figures are suppressed ("null", not zero) unless at least ${MIN_COHORT_FOR_CELL} learners are enrolled — "skills gap" reads as a low completion rate on a real, non-suppressed course.`,
        };
      });
    },
  );

  app.get(
    "/v1/orgs/:orgId/intelligence/ai-adoption",
    { preHandler: [...adminRoles, requireIntelligenceEnabled] },
    async (request) => {
      const orgId = request.orgId!;
      return withOrgTx(orgId, async (client) => {
        const rows = await client.query<{ enrolled_count: number; attempted_count: number }>(
          `SELECT count(DISTINCT e.id)::int AS enrolled_count,
                  count(DISTINCT e.id) FILTER (WHERE a.id IS NOT NULL)::int AS attempted_count
             FROM learning_enrollments e
             LEFT JOIN learning_assessment_attempts a ON a.enrollment_id = e.id
            WHERE e.organisation_id = $1`,
          [orgId],
        );
        const enrolledCount = rows.rows[0]?.enrolled_count ?? 0;
        const attemptedCount = rows.rows[0]?.attempted_count ?? 0;
        const suppressed = enrolledCount < MIN_COHORT_FOR_CELL;
        return {
          enrolledCount: suppressed ? SUPPRESSED : enrolledCount,
          attemptedCount: suppressed ? SUPPRESSED : attemptedCount,
          participationRate: suppressed || enrolledCount === 0
            ? SUPPRESSED
            : Math.round((attemptedCount / enrolledCount) * 1000) / 1000,
          definition:
            "Distinct enrolled learners who have made at least one AI-scored practice attempt, divided by all distinct enrolled learners. Scope reduction, disclosed: the plan's literal text called for an 'ai-literacy tag' on learning content, which does not exist in this schema — this is a real proxy signal (engagement with the AI-assisted practice-scoring feature), not a fabricated metric.",
          suppressionNote: `Suppressed ("null") below a cohort of ${MIN_COHORT_FOR_CELL} enrolled learners.`,
        };
      });
    },
  );

  app.get(
    "/v1/orgs/:orgId/intelligence/token-cost",
    { preHandler: [...adminRoles, requireIntelligenceEnabled] },
    async () => {
      return {
        available: false,
        reason:
          "Token-cost reporting reads from an AI-gateway invocation ledger (model_invocations) that is not part of this build yet — that table and the gateway itself belong to Delivery Plan Step 45, not yet implemented. Returning an honest placeholder rather than fabricating a figure or querying a table that doesn't exist.",
      };
    },
  );
}
