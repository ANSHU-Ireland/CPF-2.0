import type { FastifyInstance } from "fastify";
import { appendAudit } from "../../db/audit.js";
import { withOrgTx } from "../../db/pool.js";
import { requireFreshAuth, requireModuleEntitlement, requireOrgRole, sendError } from "../auth/guards.js";

const orgReadRoles = [requireOrgRole("org_admin", "hiring_manager"), requireModuleEntitlement("assessments")];
const adminRole = requireOrgRole("org_admin");


/**
 * Read-model endpoints backing the web application work queues:
 * session pipeline (with candidate, template, and review state), org member
 * directory (for reviewer assignment), and review detail with stored scores.
 */
export function registerOrgViewsRoutes(app: FastifyInstance): void {
  /** Session pipeline for the employer portal. */
  app.get("/v1/orgs/:orgId/sessions", { preHandler: orgReadRoles }, async (request) => {
    const orgId = request.orgId!;
    return withOrgTx(orgId, async (client) => {
      const rows = await client.query(
        `SELECT s.id, s.status, s.started_at, s.submitted_at, s.created_at,
                s.accommodations_note IS NOT NULL AS has_accommodations,
                c.id AS candidate_id, c.full_name AS candidate_name, c.email AS candidate_email,
                j.title AS job_title,
                t.code AS template_code,
                r.id AS review_id, r.status AS review_status, r.reviewer_user_id, r.second_reviewer_user_id
           FROM assessment_sessions s
           JOIN invitations i ON i.id = s.invitation_id
           JOIN candidates c ON c.id = i.candidate_id
           JOIN job_profiles j ON j.id = i.job_profile_id
           JOIN assessment_template_versions v ON v.id = s.template_version_id
           JOIN assessment_templates t ON t.id = v.template_id
           LEFT JOIN LATERAL (
             SELECT id, status, reviewer_user_id, second_reviewer_user_id FROM reviews
              WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1
           ) r ON true
          ORDER BY s.created_at DESC
          LIMIT 200`,
      );
      return rows.rows;
    });
  });

  /** Organisation member directory (admin) — used for reviewer assignment. */
  app.get("/v1/orgs/:orgId/users", { preHandler: adminRole }, async (request) => {
    const orgId = request.orgId!;
    return withOrgTx(orgId, async (client) => {
      const rows = await client.query(
        `SELECT u.id, u.email, u.display_name, u.status, u.mfa_enrolled,
                array_agg(m.role ORDER BY m.role) AS roles
           FROM org_memberships m
           JOIN users u ON u.id = m.user_id
          GROUP BY u.id
          ORDER BY u.display_name ASC
          LIMIT 500`,
      );
      return rows.rows;
    });
  });

  /** Review detail with stored criterion scores (reviewer resume / admin oversight). */
  app.get(
    "/v1/orgs/:orgId/reviews/:reviewId",
    { preHandler: [requireOrgRole("org_admin", "reviewer"), requireModuleEntitlement("assessments")] },
    async (request, reply) => {
      const { reviewId } = request.params as { reviewId: string };
      const orgId = request.orgId!;
      const auth = request.auth!;
      return withOrgTx(orgId, async (client) => {
        const review = await client.query<{
          id: string;
          session_id: string;
          reviewer_user_id: string;
          second_reviewer_user_id: string | null;
          status: string;
          final_rationale: string | null;
          confidence: string | null;
          limitations: string | null;
          finalised_at: Date | null;
        }>(
          `SELECT id, session_id, reviewer_user_id, second_reviewer_user_id, status, final_rationale, confidence, limitations, finalised_at
             FROM reviews WHERE id = $1`,
          [reviewId],
        );
        const row = review.rows[0];
        if (!row) return sendError(reply, 404, "NOT_FOUND", "Review not found.", request.id);
        const isReviewer = row.reviewer_user_id === auth.userId || row.second_reviewer_user_id === auth.userId;
        const isAdmin = auth.memberships.some(
          (m) => m.organisationId === orgId && m.role === "org_admin",
        );
        if (!isReviewer && !isAdmin) {
          return sendError(reply, 404, "NOT_FOUND", "Review not found.", request.id);
        }
        const scores = await client.query(
          `SELECT criterion_id, reviewer1_score, reviewer2_score, adjudicated_score, evidence_note, confidence
             FROM criterion_scores WHERE review_id = $1 ORDER BY criterion_id`,
          [reviewId],
        );
        return { ...row, scores: scores.rows };
      });
    },
  );

  /**
   * Organisation data export (CPF-27): a bulk JSON export of the org's
   * candidates, sessions, and reviews for admin-initiated backup/reporting.
   * Step-up gated — the bearer session must have re-authenticated within the
   * last few minutes (see requireFreshAuth), else 401 STEP_UP_REQUIRED.
   */
  app.get(
    "/v1/orgs/:orgId/export",
    { preHandler: [adminRole, requireModuleEntitlement("assessments"), requireFreshAuth] },
    async (request) => {
      const orgId = request.orgId!;
      const auth = request.auth!;
      return withOrgTx(orgId, async (client) => {
        const candidates = await client.query(
          `SELECT id, full_name, email, status, created_at FROM candidates ORDER BY created_at DESC LIMIT 5000`,
        );
        const sessions = await client.query(
          `SELECT s.id, s.status, s.started_at, s.submitted_at, i.candidate_id
             FROM assessment_sessions s
             JOIN invitations i ON i.id = s.invitation_id
            ORDER BY s.created_at DESC LIMIT 5000`,
        );
        const reviews = await client.query(
          `SELECT id, session_id, status, finalised_at FROM reviews ORDER BY created_at DESC LIMIT 5000`,
        );
        await appendAudit(client, {
          organisationId: orgId,
          actorUserId: auth.userId,
          action: "org.data_exported",
          entityType: "organisation",
          entityId: orgId,
          metadata: {
            candidateCount: candidates.rowCount ?? 0,
            sessionCount: sessions.rowCount ?? 0,
            reviewCount: reviews.rowCount ?? 0,
          },
        });
        return {
          exportedAt: new Date().toISOString(),
          candidates: candidates.rows,
          sessions: sessions.rows,
          reviews: reviews.rows,
        };
      });
    },
  );
}
