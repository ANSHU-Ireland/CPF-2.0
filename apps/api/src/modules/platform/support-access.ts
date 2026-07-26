import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { appendAudit } from "../../db/audit.js";
import { withOrgTx, withTx } from "../../db/pool.js";
import { requireAuth, requireOrgRole, requireSupportAccess, sendError } from "../auth/guards.js";

/**
 * Support console / JIT access (Delivery Plan Step 37). Platform staff have
 * NO standing access to any organisation's data. A platform_admin requests a
 * time-boxed (≤4h), scoped grant; that organisation's own org_admin approves
 * it before it becomes usable. A break-glass path lets a platform_admin
 * self-approve for genuine emergencies — never silent: every request,
 * approval, break-glass grant, and actual summary access writes an audit
 * entry in BOTH the platform-wide log (organisationId: null) and the
 * organisation's own log (organisationId: orgId), so either audience can see
 * the full picture from their own vantage point.
 */

const MAX_GRANT_HOURS = 4;

async function requirePlatformAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(request, reply);
  if (reply.sent) return;
  const isPlatformAdmin = request.auth?.memberships.some((m) => m.role === "platform_admin");
  if (!isPlatformAdmin) {
    await sendError(reply, 403, "FORBIDDEN", "Platform administrator role required.", request.id);
  }
}

const OrgIdParamsSchema = z.object({ orgId: z.string().uuid() });
const GrantParamsSchema = z.object({ orgId: z.string().uuid(), grantId: z.string().uuid() });

const RequestGrantSchema = z.object({
  scope: z.enum(["read_metadata", "read_evidence"]),
  reason: z.string().min(10).max(1000),
  breakGlass: z.boolean().optional(),
});

/** Writes the same event to both the platform-wide and the org's own audit log. */
async function appendDualAudit(
  client: import("../../db/pool.js").Queryable,
  args: {
    orgId: string;
    actorUserId: string;
    orgAction: string;
    platformAction: string;
    entityId: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  await appendAudit(client, {
    organisationId: args.orgId,
    actorUserId: args.actorUserId,
    action: args.orgAction,
    entityType: "support_access_grant",
    entityId: args.entityId,
    metadata: args.metadata,
  });
  await appendAudit(client, {
    organisationId: null,
    actorUserId: args.actorUserId,
    action: args.platformAction,
    entityType: "support_access_grant",
    entityId: args.entityId,
    metadata: { ...args.metadata, organisationId: args.orgId },
  });
}

export function registerSupportAccessRoutes(app: FastifyInstance): void {
  /** Request (or, w/ breakGlass, self-approve) a time-boxed support access grant. */
  app.post(
    "/v1/support/orgs/:orgId/access-grants",
    { preHandler: requirePlatformAdmin },
    async (request, reply) => {
      const params = OrgIdParamsSchema.safeParse(request.params);
      const body = RequestGrantSchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Invalid access grant request.", request.id);
      }
      const { orgId } = params.data;
      const { scope, reason, breakGlass } = body.data;
      const auth = request.auth!;
      const result = await withTx(async (client) => {
        const org = await client.query("SELECT id FROM organisations WHERE id = $1", [orgId]);
        if (org.rowCount === 0) return { outcome: "org_not_found" as const };
        const grant = await client.query<{ id: string; status: string; expires_at: Date }>(
          `INSERT INTO support_access_grants
             (organisation_id, platform_user_id, scope, reason, status, break_glass,
              approved_by_org_admin, approved_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + ($9 || ' hours')::interval)
           RETURNING id, status, expires_at`,
          [
            orgId,
            auth.userId,
            scope,
            reason,
            breakGlass ? "approved" : "pending",
            Boolean(breakGlass),
            null,
            breakGlass ? new Date() : null,
            String(MAX_GRANT_HOURS),
          ],
        );
        const grantId = grant.rows[0]!.id;
        await appendDualAudit(client, {
          orgId,
          actorUserId: auth.userId,
          orgAction: breakGlass ? "support.access_break_glass" : "support.access_requested",
          platformAction: breakGlass ? "platform.support_access_break_glass" : "platform.support_access_requested",
          entityId: grantId,
          metadata: { scope, breakGlass: Boolean(breakGlass) },
        });
        return {
          outcome: "created" as const,
          id: grantId,
          status: grant.rows[0]!.status,
          expiresAt: grant.rows[0]!.expires_at,
        };
      });
      if (result.outcome === "org_not_found") {
        return sendError(reply, 404, "NOT_FOUND", "Organisation not found.", request.id);
      }
      return reply.status(201).send({ id: result.id, status: result.status, expiresAt: result.expiresAt });
    },
  );

  /** Org_admin approves a pending grant for their own organisation. */
  app.post(
    "/v1/support/orgs/:orgId/access-grants/:grantId/approve",
    { preHandler: requireOrgRole("org_admin") },
    async (request, reply) => {
      const params = GrantParamsSchema.safeParse(request.params);
      if (!params.success) {
        return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Invalid grant reference.", request.id);
      }
      const { orgId, grantId } = params.data;
      const auth = request.auth!;
      const result = await withOrgTx(orgId, async (client) => {
        const updated = await client.query<{ id: string }>(
          `UPDATE support_access_grants
              SET status = 'approved', approved_by_org_admin = $1, approved_at = now()
            WHERE id = $2 AND organisation_id = $3 AND status = 'pending'
            RETURNING id`,
          [auth.userId, grantId, orgId],
        );
        if (updated.rowCount === 0) return { outcome: "not_found_or_not_pending" as const };
        await appendDualAudit(client, {
          orgId,
          actorUserId: auth.userId,
          orgAction: "support.access_approved",
          platformAction: "platform.support_access_approved",
          entityId: grantId,
          metadata: {},
        });
        return { outcome: "approved" as const };
      });
      if (result.outcome === "not_found_or_not_pending") {
        return sendError(
          reply,
          404,
          "NOT_FOUND",
          "No pending support access grant with that id for this organisation.",
          request.id,
        );
      }
      return reply.send({ id: grantId, status: "approved" });
    },
  );

  /**
   * Metadata-only summary: counts and session statuses, NEVER evidence
   * content, regardless of the grant's scope (no endpoint exposing evidence
   * content exists yet — read_evidence is reserved for a future one).
   */
  app.get(
    "/v1/support/orgs/:orgId/summary",
    { preHandler: requireSupportAccess },
    async (request) => {
      const orgId = request.orgId!;
      const auth = request.auth!;
      return withOrgTx(orgId, async (client) => {
        const sessionsByStatus = await client.query<{ status: string; count: number }>(
          `SELECT status, count(*)::int AS count FROM assessment_sessions
             WHERE organisation_id = $1 GROUP BY status`,
          [orgId],
        );
        const invitationCount = await client.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM invitations WHERE organisation_id = $1`,
          [orgId],
        );
        const orgUserCount = await client.query<{ count: number }>(
          `SELECT count(DISTINCT user_id)::int AS count FROM org_memberships WHERE organisation_id = $1`,
          [orgId],
        );
        await appendDualAudit(client, {
          orgId,
          actorUserId: auth.userId,
          orgAction: "support.summary_accessed",
          platformAction: "platform.support_summary_accessed",
          entityId: orgId,
          metadata: {},
        });
        return {
          organisationId: orgId,
          invitationCount: invitationCount.rows[0]?.count ?? 0,
          orgUserCount: orgUserCount.rows[0]?.count ?? 0,
          sessionsByStatus: Object.fromEntries(sessionsByStatus.rows.map((r) => [r.status, r.count])),
        };
      });
    },
  );
}
