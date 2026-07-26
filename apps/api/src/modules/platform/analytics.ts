import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { withTx } from "../../db/pool.js";
import { requireAuth, sendError } from "../auth/guards.js";

/**
 * Platform-wide analytics (Delivery Plan Step 39), aggregated across every
 * organisation. Guardrail (per the plan's own risk note): a per-template
 * breakdown could otherwise leak information about a specific org (e.g. "only
 * one org uses template X, so this cell IS that org's data") — every
 * per-template cell is suppressed unless at least MIN_ORGS distinct
 * organisations contributed a session for that template. The platform-wide
 * totals (not broken down by template) are never suppressed since they don't
 * identify any single org.
 */

const MIN_ORGS_FOR_TEMPLATE_CELL = 5;
const SUPPRESSED = null; // explicit marker: "fewer than MIN_ORGS orgs — not shown", never a fabricated 0.

async function requirePlatformAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(request, reply);
  if (reply.sent) return;
  const isPlatformAdmin = request.auth?.memberships.some((m) => m.role === "platform_admin");
  if (!isPlatformAdmin) {
    await sendError(reply, 403, "FORBIDDEN", "Platform administrator role required.", request.id);
  }
}

export function registerPlatformAnalyticsRoutes(app: FastifyInstance): void {
  app.get("/v1/platform/analytics", { preHandler: requirePlatformAdmin }, async () => {
    return withTx(async (client) => {
      // Read-only cross-org visibility for this request only (migration
      // 0015) — assessment_sessions/reviews FORCE RLS to current_org_id() by
      // default, and this route legitimately needs to aggregate across every
      // organisation. Never combine this flag with a write statement.
      await client.query("SELECT set_config('app.platform_read_all', 'true', true)");

      const totalsByStatus = await client.query<{ status: string; count: number }>(
        `SELECT status, count(*)::int AS count FROM assessment_sessions GROUP BY status`,
      );

      const byTemplate = await client.query<{
        template_code: string;
        org_count: number;
        session_count: number;
        median_reviewer_minutes: number | null;
      }>(
        `SELECT t.code AS template_code,
                count(DISTINCT s.organisation_id)::int AS org_count,
                count(DISTINCT s.id)::int AS session_count,
                percentile_cont(0.5) WITHIN GROUP (
                  ORDER BY EXTRACT(EPOCH FROM (r.finalised_at - r.started_at)) / 60.0
                ) FILTER (WHERE r.finalised_at IS NOT NULL AND r.started_at IS NOT NULL) AS median_reviewer_minutes
           FROM assessment_sessions s
           JOIN assessment_template_versions v ON v.id = s.template_version_id
           JOIN assessment_templates t ON t.id = v.template_id
           LEFT JOIN reviews r ON r.session_id = s.id
          GROUP BY t.code
          ORDER BY t.code`,
      );

      return {
        totalAssessmentsByStatus: totalsByStatus.rows,
        byTemplate: byTemplate.rows.map((r) => {
          const suppressed = r.org_count < MIN_ORGS_FOR_TEMPLATE_CELL;
          return {
            templateCode: r.template_code,
            suppressed,
            sessionCount: suppressed ? SUPPRESSED : r.session_count,
            medianReviewerMinutes: suppressed || r.median_reviewer_minutes === null
              ? SUPPRESSED
              : Math.round(r.median_reviewer_minutes * 10) / 10,
          };
        }),
        suppressionNote: `Per-template figures are suppressed ("null", not zero) unless at least ${MIN_ORGS_FOR_TEMPLATE_CELL} distinct organisations have used that template — prevents inferring a single org's data from a low-cardinality cell.`,
      };
    });
  });
}
