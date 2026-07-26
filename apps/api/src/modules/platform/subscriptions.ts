import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { appendAudit } from "../../db/audit.js";
import { withTx } from "../../db/pool.js";
import { requireAuth, sendError } from "../auth/guards.js";

/**
 * Subscriptions & entitlements (Delivery Plan Step 35). plans/org_subscriptions
 * are platform-owned (no RLS, same treatment as `organisations` itself) and
 * managed exclusively through these platform_admin-only routes.
 */

async function requirePlatformAdmin(
  request: import("fastify").FastifyRequest,
  reply: import("fastify").FastifyReply,
): Promise<void> {
  await requireAuth(request, reply);
  if (reply.sent) return;
  const isPlatformAdmin = request.auth?.memberships.some((m) => m.role === "platform_admin");
  if (!isPlatformAdmin) {
    await sendError(reply, 403, "FORBIDDEN", "Platform administrator role required.", request.id);
  }
}

const CreatePlanSchema = z.object({
  code: z.string().min(2).max(63).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u),
  name: z.string().min(2).max(200),
  moduleEntitlements: z.record(z.string(), z.boolean()).default({}),
  limits: z.record(z.string(), z.number().int().nonnegative()).default({}),
});

const AssignPlanSchema = z.object({
  planCode: z.string().min(2).max(63),
});

const OrgIdParamsSchema = z.object({ orgId: z.string().uuid() });

export function registerSubscriptionRoutes(app: FastifyInstance): void {
  app.get("/v1/platform/plans", { preHandler: requirePlatformAdmin }, async () => {
    return withTx(async (client) => {
      const rows = await client.query(
        `SELECT id, code, name, module_entitlements, limits, created_at
           FROM plans ORDER BY created_at ASC`,
      );
      return rows.rows;
    });
  });

  app.post("/v1/platform/plans", { preHandler: requirePlatformAdmin }, async (request, reply) => {
    const parsed = CreatePlanSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Invalid plan payload.", request.id);
    }
    const { code, name, moduleEntitlements, limits } = parsed.data;
    const auth = request.auth!;
    try {
      const plan = await withTx(async (client) => {
        const result = await client.query<{ id: string }>(
          `INSERT INTO plans (code, name, module_entitlements, limits)
           VALUES ($1, $2, $3::jsonb, $4::jsonb) RETURNING id`,
          [code, name, JSON.stringify(moduleEntitlements), JSON.stringify(limits)],
        );
        const planId = result.rows[0]!.id;
        await appendAudit(client, {
          organisationId: null,
          actorUserId: auth.userId,
          action: "platform.plan_created",
          entityType: "plan",
          entityId: planId,
          metadata: { code },
        });
        return planId;
      });
      return reply.status(201).send({ id: plan, code, name });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        return sendError(reply, 409, "STATE_CONFLICT", "A plan with this code already exists.", request.id);
      }
      throw error;
    }
  });

  /** Assign (or change) an organisation's plan. Upserts the subscription row. */
  app.post(
    "/v1/platform/orgs/:orgId/subscription",
    { preHandler: requirePlatformAdmin },
    async (request, reply) => {
      const params = OrgIdParamsSchema.safeParse(request.params);
      const body = AssignPlanSchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Invalid subscription assignment request.", request.id);
      }
      const { orgId } = params.data;
      const { planCode } = body.data;
      const auth = request.auth!;
      const result = await withTx(async (client) => {
        const org = await client.query("SELECT id FROM organisations WHERE id = $1", [orgId]);
        if (org.rowCount === 0) return { outcome: "org_not_found" as const };
        const plan = await client.query<{ id: string }>("SELECT id FROM plans WHERE code = $1", [planCode]);
        if (plan.rowCount === 0) return { outcome: "plan_not_found" as const };
        const planId = plan.rows[0]!.id;
        const sub = await client.query<{ id: string; status: string }>(
          `INSERT INTO org_subscriptions (organisation_id, plan_id)
           VALUES ($1, $2)
           ON CONFLICT (organisation_id)
           DO UPDATE SET plan_id = EXCLUDED.plan_id, updated_at = now()
           RETURNING id, status`,
          [orgId, planId],
        );
        await appendAudit(client, {
          organisationId: orgId,
          actorUserId: auth.userId,
          action: "platform.plan_assigned",
          entityType: "organisation",
          entityId: orgId,
          metadata: { planCode },
        });
        return { outcome: "assigned" as const, subscriptionId: sub.rows[0]!.id, status: sub.rows[0]!.status };
      });
      if (result.outcome === "org_not_found") {
        return sendError(reply, 404, "NOT_FOUND", "Organisation not found.", request.id);
      }
      if (result.outcome === "plan_not_found") {
        return sendError(reply, 404, "NOT_FOUND", "Plan not found.", request.id);
      }
      return reply.send({ subscriptionId: result.subscriptionId, planCode, status: result.status });
    },
  );

  /**
   * Suspend an organisation: blocks every org-scoped route (enforced in
   * requireOrgRole) with a clear 403 ORG_SUSPENDED. Candidate portals are
   * unaffected — they authenticate via a per-candidate token, not org
   * membership, so data-rights self-service keeps working while suspended.
   */
  app.post(
    "/v1/platform/orgs/:orgId/suspend",
    { preHandler: requirePlatformAdmin },
    async (request, reply) => {
      const params = OrgIdParamsSchema.safeParse(request.params);
      if (!params.success) {
        return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Invalid organisation id.", request.id);
      }
      const { orgId } = params.data;
      const auth = request.auth!;
      const result = await withTx(async (client) => {
        const org = await client.query("UPDATE organisations SET status = 'suspended', updated_at = now() WHERE id = $1 RETURNING id", [orgId]);
        if (org.rowCount === 0) return { outcome: "not_found" as const };
        await client.query(
          "UPDATE org_subscriptions SET status = 'suspended', updated_at = now() WHERE organisation_id = $1",
          [orgId],
        );
        await appendAudit(client, {
          organisationId: orgId,
          actorUserId: auth.userId,
          action: "platform.org_suspended",
          entityType: "organisation",
          entityId: orgId,
          metadata: {},
        });
        return { outcome: "suspended" as const };
      });
      if (result.outcome === "not_found") {
        return sendError(reply, 404, "NOT_FOUND", "Organisation not found.", request.id);
      }
      return reply.send({ organisationId: orgId, status: "suspended" });
    },
  );

  app.post(
    "/v1/platform/orgs/:orgId/resume",
    { preHandler: requirePlatformAdmin },
    async (request, reply) => {
      const params = OrgIdParamsSchema.safeParse(request.params);
      if (!params.success) {
        return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Invalid organisation id.", request.id);
      }
      const { orgId } = params.data;
      const auth = request.auth!;
      const result = await withTx(async (client) => {
        const org = await client.query("UPDATE organisations SET status = 'active', updated_at = now() WHERE id = $1 RETURNING id", [orgId]);
        if (org.rowCount === 0) return { outcome: "not_found" as const };
        await client.query(
          "UPDATE org_subscriptions SET status = 'active', updated_at = now() WHERE organisation_id = $1",
          [orgId],
        );
        await appendAudit(client, {
          organisationId: orgId,
          actorUserId: auth.userId,
          action: "platform.org_resumed",
          entityType: "organisation",
          entityId: orgId,
          metadata: {},
        });
        return { outcome: "resumed" as const };
      });
      if (result.outcome === "not_found") {
        return sendError(reply, 404, "NOT_FOUND", "Organisation not found.", request.id);
      }
      return reply.send({ organisationId: orgId, status: "active" });
    },
  );
}
