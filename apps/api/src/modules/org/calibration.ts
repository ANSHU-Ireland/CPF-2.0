import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { appendAudit } from "../../db/audit.js";
import { withOrgTx, type Queryable } from "../../db/pool.js";
import { requireOrgRole, sendError } from "../auth/guards.js";

const adminRole = requireOrgRole("org_admin");

const RecordCalibrationSchema = z.object({
  reviewerUserId: z.string().uuid(),
  frameworkVersion: z.string().min(1).max(50),
  expiresAt: z.string().datetime().optional(),
});

interface CalibrationRow {
  id: string;
  reviewer_user_id: string;
  framework_version: string;
  status: string;
  calibrated_at: Date;
  expires_at: Date | null;
}

function toResponse(row: CalibrationRow) {
  return {
    id: row.id,
    reviewerUserId: row.reviewer_user_id,
    frameworkVersion: row.framework_version,
    status: row.status,
    calibratedAt: row.calibrated_at,
    expiresAt: row.expires_at,
  };
}

/**
 * Returns null if the reviewer holds a valid (non-expired, non-revoked)
 * calibration record for the given framework version; otherwise a reason.
 */
export async function checkReviewerCalibrated(
  client: Queryable,
  orgId: string,
  reviewerUserId: string,
  frameworkVersion: string,
): Promise<"OK" | "NOT_CALIBRATED"> {
  const rows = await client.query<{ status: string; expires_at: Date | null }>(
    `SELECT status, expires_at FROM reviewer_calibration_records
      WHERE organisation_id = $1 AND reviewer_user_id = $2 AND framework_version = $3
      ORDER BY calibrated_at DESC`,
    [orgId, reviewerUserId, frameworkVersion],
  );
  const valid = rows.rows.find(
    (r) => r.status === "valid" && (r.expires_at === null || r.expires_at.getTime() > Date.now()),
  );
  return valid ? "OK" : "NOT_CALIBRATED";
}

export function registerCalibrationRoutes(app: FastifyInstance): void {
  /** Record a reviewer's calibration for a framework version (org admin). */
  app.post(
    "/v1/orgs/:orgId/reviewer-calibrations",
    { preHandler: adminRole },
    async (request, reply) => {
      const parsed = RecordCalibrationSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "reviewerUserId and frameworkVersion are required.", request.id);
      }
      const orgId = request.orgId!;
      const auth = request.auth!;
      const result = await withOrgTx(orgId, async (client) => {
        const membership = await client.query(
          "SELECT 1 FROM org_memberships WHERE organisation_id = $1 AND user_id = $2 AND role = 'reviewer'",
          [orgId, parsed.data.reviewerUserId],
        );
        if (membership.rowCount === 0) return { error: "NOT_A_REVIEWER" as const };
        const row = await client.query<CalibrationRow>(
          `INSERT INTO reviewer_calibration_records
             (organisation_id, reviewer_user_id, framework_version, expires_at, created_by)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, reviewer_user_id, framework_version, status, calibrated_at, expires_at`,
          [
            orgId,
            parsed.data.reviewerUserId,
            parsed.data.frameworkVersion,
            parsed.data.expiresAt ?? null,
            auth.userId,
          ],
        );
        await appendAudit(client, {
          organisationId: orgId,
          actorUserId: auth.userId,
          action: "reviewer_calibration.recorded",
          entityType: "reviewer_calibration_record",
          entityId: row.rows[0]!.id,
          metadata: { reviewerUserId: parsed.data.reviewerUserId, frameworkVersion: parsed.data.frameworkVersion },
        });
        return { record: toResponse(row.rows[0]!) };
      });
      if ("error" in result) {
        return sendError(reply, 422, "NOT_A_REVIEWER", "The user does not hold the reviewer role in this organisation.", request.id);
      }
      return reply.status(201).send(result.record);
    },
  );

  /** List calibration records, optionally scoped to a reviewer (org admin). */
  app.get(
    "/v1/orgs/:orgId/reviewer-calibrations",
    { preHandler: adminRole },
    async (request) => {
      const orgId = request.orgId!;
      const { reviewerUserId } = request.query as { reviewerUserId?: string };
      return withOrgTx(orgId, async (client) => {
        const rows = reviewerUserId
          ? await client.query<CalibrationRow>(
              `SELECT id, reviewer_user_id, framework_version, status, calibrated_at, expires_at
                 FROM reviewer_calibration_records
                WHERE organisation_id = $1 AND reviewer_user_id = $2
                ORDER BY calibrated_at DESC`,
              [orgId, reviewerUserId],
            )
          : await client.query<CalibrationRow>(
              `SELECT id, reviewer_user_id, framework_version, status, calibrated_at, expires_at
                 FROM reviewer_calibration_records
                WHERE organisation_id = $1
                ORDER BY calibrated_at DESC`,
              [orgId],
            );
        return { records: rows.rows.map(toResponse) };
      });
    },
  );

  /** Revoke a calibration record (org admin). */
  app.delete(
    "/v1/orgs/:orgId/reviewer-calibrations/:recordId",
    { preHandler: adminRole },
    async (request, reply) => {
      const orgId = request.orgId!;
      const auth = request.auth!;
      const { recordId } = request.params as { recordId: string };
      const result = await withOrgTx(orgId, async (client) => {
        const row = await client.query(
          `UPDATE reviewer_calibration_records SET status = 'revoked'
             WHERE id = $1 AND organisation_id = $2 RETURNING id`,
          [recordId, orgId],
        );
        if (row.rowCount === 0) return { error: "NOT_FOUND" as const };
        await appendAudit(client, {
          organisationId: orgId,
          actorUserId: auth.userId,
          action: "reviewer_calibration.revoked",
          entityType: "reviewer_calibration_record",
          entityId: recordId,
          metadata: {},
        });
        return { ok: true as const };
      });
      if ("error" in result) {
        return sendError(reply, 404, "NOT_FOUND", "Calibration record not found.", request.id);
      }
      return reply.status(204).send();
    },
  );
}
