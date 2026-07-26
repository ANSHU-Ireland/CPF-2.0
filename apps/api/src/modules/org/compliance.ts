import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { appendAudit } from "../../db/audit.js";
import { withOrgTx } from "../../db/pool.js";
import { requireFreshAuth, requireOrgRole, sendError } from "../auth/guards.js";
import { neutraliseCsvFormula } from "./csv.js";

/**
 * Compliance operations console (Delivery Plan Step 38): audit search/export
 * and the retention policy editor. Deliberately NOT module-gated
 * (requireModuleEntitlement) — compliance/accountability tooling is a base
 * admin capability, the same treatment already given to data-rights.ts and
 * legal holds, not a paid commercial module.
 */

const adminRole = requireOrgRole("org_admin");

const MAX_EXPORT_ROWS = 5_000;

const AuditSearchQuerySchema = z.object({
  entityType: z.string().min(1).max(100).optional(),
  action: z.string().min(1).max(200).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

type AuditSearchFilters = z.infer<typeof AuditSearchQuerySchema>;

const RetentionPolicyUpdateSchema = z.object({
  evidenceRetentionDays: z.number().int().positive().max(3_650),
  integrityRetentionDays: z.number().int().positive().max(3_650),
  auditRetentionDays: z.number().int().positive().max(3_650),
  deletionMode: z.enum(["hard_delete", "anonymise_then_delete"]),
});

function buildAuditFilter(orgId: string, filters: AuditSearchFilters): { where: string; params: unknown[] } {
  const params: unknown[] = [orgId];
  const clauses = ["organisation_id = $1"];
  if (filters.entityType) {
    params.push(filters.entityType);
    clauses.push(`entity_type = $${params.length}`);
  }
  if (filters.action) {
    params.push(filters.action);
    clauses.push(`action = $${params.length}`);
  }
  if (filters.from) {
    params.push(filters.from);
    clauses.push(`occurred_at >= $${params.length}::timestamptz`);
  }
  if (filters.to) {
    params.push(filters.to);
    clauses.push(`occurred_at <= $${params.length}::timestamptz`);
  }
  return { where: clauses.join(" AND "), params };
}

/** CSV field encoding: standard quoting/escaping plus the existing formula-injection guard. */
function toCsvField(value: string): string {
  const safe = neutraliseCsvFormula(value);
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function registerComplianceRoutes(app: FastifyInstance): void {
  /** Paginated, filterable audit search for the compliance console's explorer page. */
  app.get("/v1/orgs/:orgId/audit/search", { preHandler: adminRole }, async (request, reply) => {
    const parsed = AuditSearchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Invalid audit search filters.", request.id);
    }
    const orgId = request.orgId!;
    const { limit, offset } = parsed.data;
    return withOrgTx(orgId, async (client) => {
      const { where, params } = buildAuditFilter(orgId, parsed.data);
      const rows = await client.query(
        `SELECT id, action, entity_type, entity_id, actor_user_id, occurred_at, metadata
           FROM audit_log WHERE ${where}
          ORDER BY occurred_at DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );
      const total = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM audit_log WHERE ${where}`,
        params,
      );
      return { items: rows.rows, total: total.rows[0]?.count ?? 0, limit, offset };
    });
  });

  /**
   * CSV export of a filtered audit slice. Personal-data egress (Risk, per
   * the plan) — gated by requireFreshAuth in addition to org_admin, and the
   * export itself is audited.
   */
  app.get(
    "/v1/orgs/:orgId/audit/export",
    { preHandler: [adminRole, requireFreshAuth] },
    async (request, reply) => {
      const parsed = AuditSearchQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Invalid audit export filters.", request.id);
      }
      const orgId = request.orgId!;
      const auth = request.auth!;
      const csv = await withOrgTx(orgId, async (client) => {
        const { where, params } = buildAuditFilter(orgId, parsed.data);
        const rows = await client.query<{
          id: string;
          action: string;
          entity_type: string;
          entity_id: string | null;
          actor_user_id: string | null;
          occurred_at: Date;
          metadata: Record<string, unknown>;
        }>(
          `SELECT id, action, entity_type, entity_id, actor_user_id, occurred_at, metadata
             FROM audit_log WHERE ${where}
            ORDER BY occurred_at DESC LIMIT ${MAX_EXPORT_ROWS}`,
          params,
        );
        await appendAudit(client, {
          organisationId: orgId,
          actorUserId: auth.userId,
          action: "compliance.audit_exported",
          entityType: "organisation",
          entityId: orgId,
          metadata: { rowCount: rows.rowCount ?? 0, filters: parsed.data },
        });
        const header = "id,occurred_at,action,entity_type,entity_id,actor_user_id,metadata";
        const lines = rows.rows.map((r) =>
          [
            String(r.id),
            r.occurred_at.toISOString(),
            r.action,
            r.entity_type,
            r.entity_id ?? "",
            r.actor_user_id ?? "",
            JSON.stringify(r.metadata),
          ]
            .map(toCsvField)
            .join(","),
        );
        return [header, ...lines].join("\r\n");
      });
      reply.header("content-type", "text/csv; charset=utf-8");
      reply.header("content-disposition", `attachment; filename="audit-export-${orgId}.csv"`);
      return reply.send(csv);
    },
  );

  /** Retention policy read: current settings + the most recent sweep from the audit trail. */
  app.get("/v1/orgs/:orgId/retention-policy", { preHandler: adminRole }, async (request, reply) => {
    const orgId = request.orgId!;
    const result = await withOrgTx(orgId, async (client) => {
      const policy = await client.query<{
        evidence_retention_days: number;
        integrity_retention_days: number;
        audit_retention_days: number;
        deletion_mode: string;
        updated_at: Date;
      }>(
        `SELECT evidence_retention_days, integrity_retention_days, audit_retention_days, deletion_mode, updated_at
           FROM retention_policies WHERE organisation_id = $1`,
        [orgId],
      );
      const lastRun = await client.query<{ occurred_at: Date; metadata: Record<string, unknown> }>(
        `SELECT occurred_at, metadata FROM audit_log
          WHERE organisation_id = $1 AND action = 'retention.sweep_executed'
          ORDER BY occurred_at DESC LIMIT 1`,
        [orgId],
      );
      return { policy: policy.rows[0], lastRun: lastRun.rows[0] };
    });
    if (!result.policy) {
      return sendError(reply, 404, "NOT_FOUND", "No retention policy configured for this organisation.", request.id);
    }
    return {
      policy: result.policy,
      lastRun: result.lastRun ? { occurredAt: result.lastRun.occurred_at, ...result.lastRun.metadata } : null,
      // There is no scheduler/cron-tracking table yet — the sweep runs via a
      // manually-invoked or externally-scheduled task (see the operations
      // runbook), so honestly there is no guaranteed "next due" timestamp to
      // report here, only this disclaimer.
      schedulingNote:
        "The retention sweep runs manually or via an externally-scheduled task, not a tracked in-app schedule — there is no guaranteed next-run time to display.",
    };
  });

  /** Retention policy editor (write), validated and audited. */
  app.put("/v1/orgs/:orgId/retention-policy", { preHandler: adminRole }, async (request, reply) => {
    const parsed = RetentionPolicyUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Invalid retention policy values.", request.id);
    }
    const orgId = request.orgId!;
    const auth = request.auth!;
    const { evidenceRetentionDays, integrityRetentionDays, auditRetentionDays, deletionMode } = parsed.data;
    const updated = await withOrgTx(orgId, async (client) => {
      const result = await client.query(
        `UPDATE retention_policies
            SET evidence_retention_days = $1, integrity_retention_days = $2,
                audit_retention_days = $3, deletion_mode = $4, updated_at = now()
          WHERE organisation_id = $5`,
        [evidenceRetentionDays, integrityRetentionDays, auditRetentionDays, deletionMode, orgId],
      );
      if ((result.rowCount ?? 0) === 0) return false;
      await appendAudit(client, {
        organisationId: orgId,
        actorUserId: auth.userId,
        action: "compliance.retention_policy_updated",
        entityType: "retention_policy",
        entityId: orgId,
        metadata: { evidenceRetentionDays, integrityRetentionDays, auditRetentionDays, deletionMode },
      });
      return true;
    });
    if (!updated) {
      return sendError(reply, 404, "NOT_FOUND", "No retention policy configured for this organisation.", request.id);
    }
    return reply.send({ updated: true });
  });
}
