import type { FastifyInstance } from "fastify";
import { withOrgTx } from "../../db/pool.js";
import { requireOrgRole } from "../auth/guards.js";

/**
 * Org-level analytics + reviewer-minutes telemetry (Delivery Plan Step 39).
 * Own-organisation data only — deliberately NOT module-gated
 * (requireModuleEntitlement), same treatment already given to usage.ts and
 * compliance.ts: this is a baseline operational/accountability capability,
 * not a paid add-on, and it feeds the (still-open) pricing decision R-09.
 *
 * "Reviewer minutes" = finalised_at - started_at on a `reviews` row.
 * started_at is set the moment a reviewer's FIRST score save transitions the
 * review out of `assigned` (see reviews.ts); a review with no started_at (an
 * assigned-but-not-yet-begun review) is excluded from the minutes figure,
 * never treated as zero.
 */

const adminRole = requireOrgRole("org_admin");

export function registerOrgAnalyticsRoutes(app: FastifyInstance): void {
  app.get("/v1/orgs/:orgId/analytics", { preHandler: adminRole }, async (request) => {
    const orgId = request.orgId!;
    return withOrgTx(orgId, async (client) => {
      const byStatus = await client.query<{ status: string; count: number }>(
        `SELECT status, count(*)::int AS count
           FROM assessment_sessions WHERE organisation_id = $1 GROUP BY status`,
        [orgId],
      );

      const byTemplate = await client.query<{
        template_code: string;
        session_count: number;
        median_reviewer_minutes: number | null;
      }>(
        `SELECT t.code AS template_code,
                count(DISTINCT s.id)::int AS session_count,
                percentile_cont(0.5) WITHIN GROUP (
                  ORDER BY EXTRACT(EPOCH FROM (r.finalised_at - r.started_at)) / 60.0
                ) FILTER (WHERE r.finalised_at IS NOT NULL AND r.started_at IS NOT NULL) AS median_reviewer_minutes
           FROM assessment_sessions s
           JOIN assessment_template_versions v ON v.id = s.template_version_id
           JOIN assessment_templates t ON t.id = v.template_id
           LEFT JOIN reviews r ON r.session_id = s.id
          WHERE s.organisation_id = $1
          GROUP BY t.code
          ORDER BY t.code`,
        [orgId],
      );

      // Completion rate: of sessions the candidate actually started, how many
      // reached report_issued. Sessions never started (still created/pending
      // disclosure) are excluded from the denominator — an honest "of those
      // who began, how many finished" figure, not "of those invited".
      const completion = await client.query<{ started: number; completed: number }>(
        `SELECT count(*) FILTER (WHERE started_at IS NOT NULL)::int AS started,
                count(*) FILTER (WHERE status = 'report_issued')::int AS completed
           FROM assessment_sessions WHERE organisation_id = $1`,
        [orgId],
      );

      // Challenge rate: of candidates who received a finalised report, how
      // many filed a data-rights "challenge" request. Data-rights requests
      // are candidate-level (not session-level), so this is necessarily an
      // org-wide figure, not per-template.
      const challenge = await client.query<{ reported: number; challenged: number }>(
        `SELECT
           (SELECT count(DISTINCT c.id)::int
              FROM candidates c
              JOIN invitations i ON i.candidate_id = c.id
              JOIN assessment_sessions s ON s.invitation_id = i.id
             WHERE c.organisation_id = $1 AND s.status = 'report_issued') AS reported,
           (SELECT count(DISTINCT candidate_id)::int
              FROM data_rights_requests
             WHERE organisation_id = $1 AND request_type = 'challenge') AS challenged`,
        [orgId],
      );

      const startedCount = completion.rows[0]?.started ?? 0;
      const completedCount = completion.rows[0]?.completed ?? 0;
      const reportedCount = challenge.rows[0]?.reported ?? 0;
      const challengedCount = challenge.rows[0]?.challenged ?? 0;

      return {
        assessmentsByStatus: byStatus.rows,
        byTemplate: byTemplate.rows.map((r) => ({
          templateCode: r.template_code,
          sessionCount: r.session_count,
          medianReviewerMinutes: r.median_reviewer_minutes === null ? null : Math.round(r.median_reviewer_minutes * 10) / 10,
        })),
        completionRate: {
          startedCount,
          completedCount,
          rate: startedCount > 0 ? Math.round((completedCount / startedCount) * 1000) / 1000 : null,
          definition: "completed (report_issued) / started (has a started_at), among this org's own sessions.",
        },
        challengeRate: {
          reportedCount,
          challengedCount,
          rate: reportedCount > 0 ? Math.round((challengedCount / reportedCount) * 1000) / 1000 : null,
          definition:
            "distinct candidates with a data-rights 'challenge' request / distinct candidates with at least one report_issued session. Candidate-level, not session-level, since data-rights requests aren't tied to a specific session.",
        },
      };
    });
  });
}
