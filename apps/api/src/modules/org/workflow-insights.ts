import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { appendAudit } from "../../db/audit.js";
import { withOrgTx } from "../../db/pool.js";
import { requireModuleEntitlement, requireOrgRole, sendError } from "../auth/guards.js";

/**
 * Workflow Insights (Delivery Plan Step 46) — the first module mounted
 * through the plugin/module registry (module-registry.ts). Autonomy level 2:
 * every recommendation is a PROPOSAL a human must approve or dismiss; there
 * is no route anywhere in this file that takes any automated action as a
 * result of a decision (approving a proposal only records the decision —
 * Phase 1 has no execution capability wired to it, disclosed honestly per
 * the plan's own risk note against over-abstraction/shipped automation).
 *
 * Signals drawn from data that ALREADY exists elsewhere in the schema,
 * reusing the same k-anonymity floor as Step 43's intelligence aggregates
 * (MIN_COHORT_FOR_CELL = 8) so this module never surfaces a pain-point theme
 * or course figure that intelligence.ts itself would suppress:
 *   - pain-point theme with count >= the cohort floor → a proposed action.
 *   - a published course with >= the cohort floor enrolled learners and a
 *     completion rate below LOW_COMPLETION_RATE_THRESHOLD → a proposed action.
 * `generate` is idempotent per (organisation, source_type, source_key): it
 * skips re-proposing a signal that already has a non-dismissed proposal open,
 * so repeated runs don't spam duplicate rows.
 */

const MIN_COHORT_FOR_CELL = 8;
const LOW_COMPLETION_RATE_THRESHOLD = 0.5;

const adminRoles = [requireOrgRole("org_admin"), requireModuleEntitlement("workflow_insights")];
const anyOrgRole = [
  requireOrgRole("org_admin", "hiring_manager", "reviewer", "learning_admin", "support_agent"),
  requireModuleEntitlement("workflow_insights"),
];

const ListQuerySchema = z.object({
  status: z.enum(["proposed", "approved", "dismissed"]).optional(),
});

export function registerWorkflowInsightsRoutes(app: FastifyInstance): void {
  // Cheap any-role smoke check, matching the learning/intelligence status-route
  // convention — lets the web Shell gate nav without needing an admin-only route.
  app.get("/v1/orgs/:orgId/workflow-insights/status", { preHandler: anyOrgRole }, async () => {
    return { module: "workflow_insights" as const, enabled: true };
  });

  app.get("/v1/orgs/:orgId/workflow-insights/proposals", { preHandler: adminRoles }, async (request, reply) => {
    const parsed = ListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Invalid query.", request.id);
    }
    const orgId = request.orgId!;
    const { status } = parsed.data;
    return withOrgTx(orgId, async (client) => {
      const result = await client.query<{
        id: string;
        source_type: string;
        source_key: string;
        title: string;
        rationale: string;
        status: string;
        decided_by_user_id: string | null;
        decided_at: Date | null;
        created_at: Date;
      }>(
        status
          ? `SELECT * FROM workflow_insight_proposals WHERE organisation_id = $1 AND status = $2 ORDER BY created_at DESC`
          : `SELECT * FROM workflow_insight_proposals WHERE organisation_id = $1 ORDER BY created_at DESC`,
        status ? [orgId, status] : [orgId],
      );
      return {
        proposals: result.rows.map((r) => ({
          id: r.id,
          sourceType: r.source_type,
          sourceKey: r.source_key,
          title: r.title,
          rationale: r.rationale,
          status: r.status,
          decidedByUserId: r.decided_by_user_id,
          decidedAt: r.decided_at,
          createdAt: r.created_at,
        })),
      };
    });
  });

  app.post("/v1/orgs/:orgId/workflow-insights/generate", { preHandler: adminRoles }, async (request, reply) => {
    const orgId = request.orgId!;
    const created = await withOrgTx(orgId, async (client) => {
      const insertedIds: string[] = [];

      const openKeys = await client.query<{ source_key: string }>(
        `SELECT source_key FROM workflow_insight_proposals WHERE organisation_id = $1 AND status != 'dismissed'`,
        [orgId],
      );
      const alreadyOpen = new Set(openKeys.rows.map((r) => r.source_key));

      const themeRows = await client.query<{ category: string; count: number }>(
        `SELECT category::text AS category, count(*)::int AS count
           FROM pain_point_reports WHERE organisation_id = $1 GROUP BY category`,
        [orgId],
      );
      for (const row of themeRows.rows) {
        if (row.count < MIN_COHORT_FOR_CELL) continue;
        const sourceKey = `pain_point_theme:${row.category}`;
        if (alreadyOpen.has(sourceKey)) continue;
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO workflow_insight_proposals (organisation_id, source_type, source_key, title, rationale)
           VALUES ($1, 'pain_point_theme', $2, $3, $4) RETURNING id`,
          [
            orgId,
            sourceKey,
            `Address recurring "${row.category}" pain points`,
            `${row.count} employees reported a "${row.category}" pain point (aggregate count only — no individual reports are referenced). Consider a targeted process or tooling review.`,
          ],
        );
        insertedIds.push(inserted.rows[0]!.id);
      }

      const courseRows = await client.query<{
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
          GROUP BY c.id, c.title`,
        [orgId],
      );
      for (const row of courseRows.rows) {
        if (row.enrolled_count < MIN_COHORT_FOR_CELL) continue;
        const completionRate = row.completed_count / row.enrolled_count;
        if (completionRate >= LOW_COMPLETION_RATE_THRESHOLD) continue;
        const sourceKey = `learning_gap:${row.course_id}`;
        if (alreadyOpen.has(sourceKey)) continue;
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO workflow_insight_proposals (organisation_id, source_type, source_key, title, rationale)
           VALUES ($1, 'learning_gap', $2, $3, $4) RETURNING id`,
          [
            orgId,
            sourceKey,
            `Boost completion of "${row.title}"`,
            `Only ${Math.round(completionRate * 100)}% of ${row.enrolled_count} enrolled learners have completed "${row.title}". Consider a completion nudge or reviewing the course's length/difficulty.`,
          ],
        );
        insertedIds.push(inserted.rows[0]!.id);
      }

      if (insertedIds.length > 0) {
        await appendAudit(client, {
          organisationId: orgId,
          actorUserId: request.auth!.userId,
          action: "workflow_insights.generated",
          entityType: "workflow_insight_proposal",
          entityId: null,
          metadata: { count: insertedIds.length },
        });
      }
      return insertedIds;
    });
    return reply.status(201).send({ createdCount: created.length, createdIds: created });
  });

  app.post("/v1/orgs/:orgId/workflow-insights/proposals/:proposalId/approve", { preHandler: adminRoles }, async (request, reply) => {
    return decide(request, reply, "approved");
  });

  app.post("/v1/orgs/:orgId/workflow-insights/proposals/:proposalId/dismiss", { preHandler: adminRoles }, async (request, reply) => {
    return decide(request, reply, "dismissed");
  });
}

async function decide(
  request: FastifyRequest,
  reply: FastifyReply,
  status: "approved" | "dismissed",
): Promise<unknown> {
  const orgId = request.orgId!;
  const { proposalId } = request.params as { proposalId: string };
  return withOrgTx(orgId, async (client) => {
    const existing = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM workflow_insight_proposals WHERE id = $1 AND organisation_id = $2`,
      [proposalId, orgId],
    );
    if (existing.rowCount === 0) {
      return sendError(reply, 404, "NOT_FOUND", "Proposal not found.", request.id);
    }
    if (existing.rows[0]!.status !== "proposed") {
      return sendError(reply, 409, "STATE_CONFLICT", "This proposal has already been decided.", request.id);
    }
    const updated = await client.query<{ id: string; status: string; decided_at: Date }>(
      `UPDATE workflow_insight_proposals
          SET status = $1, decided_by_user_id = $2, decided_at = now(), updated_at = now()
        WHERE id = $3 RETURNING id, status, decided_at`,
      [status, request.auth!.userId, proposalId],
    );
    await appendAudit(client, {
      organisationId: orgId,
      actorUserId: request.auth!.userId,
      action: status === "approved" ? "workflow_insights.approved" : "workflow_insights.dismissed",
      entityType: "workflow_insight_proposal",
      entityId: proposalId,
      metadata: {},
    });
    return { id: updated.rows[0]!.id, status: updated.rows[0]!.status, decidedAt: updated.rows[0]!.decided_at };
  });
}
