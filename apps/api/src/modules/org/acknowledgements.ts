import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { appendAudit } from "../../db/audit.js";
import { withOrgTx } from "../../db/pool.js";
import { requireOrgRole, sendError } from "../auth/guards.js";

const managerRoles = requireOrgRole("org_admin", "hiring_manager");

/**
 * Responsible-use acknowledgement (CPF-34). Versioned so that a content
 * change (e.g. after legal review, LR-04) forces every employer-side viewer
 * to re-acknowledge before their next Evidence Profile view. Bump the
 * version string whenever the wording changes materially.
 */
export const RESPONSIBLE_USE_VERSION = "2026-07-25";

export const RESPONSIBLE_USE_DOCUMENT = {
  version: RESPONSIBLE_USE_VERSION,
  title: "Responsible use of the Evidence Profile",
  sections: [
    "This Evidence Profile is decision SUPPORT, not a decision. No score, band, " +
      "or system in this platform issues an automated hiring, ranking, or " +
      "rejection outcome — every outcome remains a human decision made by you " +
      "and your organisation.",
    "Dimension bands and interview probes describe observed evidence of AI " +
      "collaboration practice for this task only. They are not a measure of a " +
      "candidate's general ability, character, or suitability for employment.",
    "You must not convert bands or probes into a numeric score, ranking, or " +
      "pass/fail threshold outside this platform, and must not share this " +
      "profile outside your organisation's assessment process.",
    "Accommodations noted on this profile reflect adjustments already applied " +
      "during the assessment; do not penalise a candidate for their presence.",
    "If you believe this profile is inaccurate or incomplete, use your " +
      "organisation's review process to request a correction rather than " +
      "acting on it directly.",
  ],
};

export function registerAcknowledgementRoutes(app: FastifyInstance): void {
  app.get(
    "/v1/orgs/:orgId/acknowledgements/responsible-use",
    { preHandler: managerRoles },
    async (request) => {
      const orgId = request.orgId!;
      const auth = request.auth!;
      return withOrgTx(orgId, async (client) => {
        const row = await client.query<{ acknowledged_at: Date }>(
          "SELECT acknowledged_at FROM employer_acknowledgements WHERE organisation_id = $1 AND user_id = $2 AND document_version = $3",
          [orgId, auth.userId, RESPONSIBLE_USE_VERSION],
        );
        return {
          ...RESPONSIBLE_USE_DOCUMENT,
          acknowledged: row.rows.length > 0,
          acknowledgedAt: row.rows[0]?.acknowledged_at ?? null,
        };
      });
    },
  );

  app.post(
    "/v1/orgs/:orgId/acknowledgements/responsible-use",
    { preHandler: managerRoles },
    async (request, reply) => {
      const schema = z.object({ version: z.string().min(1).max(50) });
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "version is required.", request.id);
      }
      if (parsed.data.version !== RESPONSIBLE_USE_VERSION) {
        return sendError(
          reply,
          409,
          "STALE_DOCUMENT_VERSION",
          "The responsible-use document has changed; reload and re-acknowledge the current version.",
          request.id,
        );
      }
      const orgId = request.orgId!;
      const auth = request.auth!;
      const acknowledgedAt = await withOrgTx(orgId, async (client) => {
        const result = await client.query<{ acknowledged_at: Date }>(
          `INSERT INTO employer_acknowledgements (organisation_id, user_id, document_version)
           VALUES ($1, $2, $3)
           ON CONFLICT (organisation_id, user_id, document_version) DO UPDATE SET document_version = EXCLUDED.document_version
           RETURNING acknowledged_at`,
          [orgId, auth.userId, RESPONSIBLE_USE_VERSION],
        );
        await appendAudit(client, {
          organisationId: orgId,
          actorUserId: auth.userId,
          action: "compliance.responsible_use_acknowledged",
          entityType: "employer_acknowledgement",
          entityId: auth.userId,
          metadata: { version: RESPONSIBLE_USE_VERSION },
        });
        return result.rows[0]!.acknowledged_at;
      });
      return reply.status(201).send({ acknowledged: true, version: RESPONSIBLE_USE_VERSION, acknowledgedAt });
    },
  );
}

/** Shared guard used by the evidence-profile endpoint (CPF-34 precondition). */
export async function requireResponsibleUseAck(
  client: import("../../db/pool.js").Queryable,
  organisationId: string,
  userId: string,
): Promise<boolean> {
  const row = await client.query(
    "SELECT 1 FROM employer_acknowledgements WHERE organisation_id = $1 AND user_id = $2 AND document_version = $3",
    [organisationId, userId, RESPONSIBLE_USE_VERSION],
  );
  return (row.rowCount ?? 0) > 0;
}
