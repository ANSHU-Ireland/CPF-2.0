import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  dataRightsMachine,
  InvalidTransitionError,
  type DataRightsEvent,
  type DataRightsState,
} from "@cpf/assessment-framework";
import { appendAudit } from "../../db/audit.js";
import { withOrgTx, type Queryable } from "../../db/pool.js";
import { requireOrgRole, sendError } from "../auth/guards.js";

const adminRole = requireOrgRole("org_admin");

const TransitionSchema = z.object({
  event: z.enum([
    "verify_identity",
    "begin",
    "refer_to_controller",
    "controller_responded",
    "fulfil",
    "refuse_with_grounds",
    "withdraw",
  ]),
  note: z.string().max(5_000).optional(),
});

export class LegalHoldActiveError extends Error {
  constructor() {
    super("An active legal hold prevents erasure for this candidate.");
    this.name = "LegalHoldActiveError";
  }
}

/**
 * Erasure execution (GDPR Art. 17 support).
 *
 * Deletes capability evidence, integrity signals, scores, and ledger claims;
 * anonymises the candidate identity record. Disclosure records and the audit
 * chain are retained for accountability (see retention matrix), now referring
 * to an anonymised subject. Blocked entirely by an active legal hold (BR-10).
 */
export async function eraseCandidateData(
  client: Queryable,
  organisationId: string,
  candidateId: string,
): Promise<Record<string, number>> {
  const hold = await client.query(
    "SELECT 1 FROM legal_holds WHERE candidate_id = $1 AND released_at IS NULL",
    [candidateId],
  );
  if ((hold.rowCount ?? 0) > 0) throw new LegalHoldActiveError();

  const sessions = await client.query<{ id: string }>(
    `SELECT s.id FROM assessment_sessions s
       JOIN invitations i ON i.id = s.invitation_id
      WHERE i.candidate_id = $1`,
    [candidateId],
  );
  const sessionIds = sessions.rows.map((r) => r.id);
  const counts: Record<string, number> = {
    evidenceEvents: 0,
    criterionScores: 0,
    ledgerClaims: 0,
  };
  if (sessionIds.length > 0) {
    counts.evidenceEvents =
      (await client.query("DELETE FROM evidence_events WHERE session_id = ANY($1)", [sessionIds])).rowCount ?? 0;
    counts.criterionScores =
      (
        await client.query(
          "DELETE FROM criterion_scores WHERE review_id IN (SELECT id FROM reviews WHERE session_id = ANY($1))",
          [sessionIds],
        )
      ).rowCount ?? 0;
    counts.ledgerClaims =
      (
        await client.query(
          "DELETE FROM evidence_ledger_claims WHERE review_id IN (SELECT id FROM reviews WHERE session_id = ANY($1))",
          [sessionIds],
        )
      ).rowCount ?? 0;
  }
  // Remove candidate-portal routing so the token can never resolve again.
  await client.query(
    "DELETE FROM invitation_lookup WHERE invitation_id IN (SELECT id FROM invitations WHERE candidate_id = $1)",
    [candidateId],
  );
  await client.query(
    `UPDATE candidates
        SET email = 'erased+' || id || '@anonymised.invalid',
            full_name = 'Erased on data-subject request',
            status = 'anonymised',
            updated_at = now()
      WHERE id = $1`,
    [candidateId],
  );
  await appendAudit(client, {
    organisationId,
    action: "data_rights.erasure_executed",
    entityType: "candidate",
    entityId: candidateId,
    metadata: counts,
  });
  return counts;
}

/** Verification query: proves no personal data remains for the candidate. */
export async function verifyErasure(
  client: Queryable,
  candidateId: string,
): Promise<{ clean: boolean; residual: Record<string, number> }> {
  const residualEvents = await client.query(
    `SELECT count(*)::int AS n FROM evidence_events e
       JOIN assessment_sessions s ON s.id = e.session_id
       JOIN invitations i ON i.id = s.invitation_id
      WHERE i.candidate_id = $1`,
    [candidateId],
  );
  const candidate = await client.query<{ status: string; email: string }>(
    "SELECT status, email FROM candidates WHERE id = $1",
    [candidateId],
  );
  const events = (residualEvents.rows[0] as { n: number }).n;
  const anonymised =
    candidate.rows[0]?.status === "anonymised" &&
    candidate.rows[0].email.endsWith("@anonymised.invalid");
  return {
    clean: events === 0 && anonymised,
    residual: { evidenceEvents: events, candidateAnonymised: anonymised ? 1 : 0 },
  };
}

export function registerDataRightsRoutes(app: FastifyInstance): void {
  app.get("/v1/orgs/:orgId/data-rights", { preHandler: adminRole }, async (request) => {
    const orgId = request.orgId!;
    return withOrgTx(orgId, async (client) => {
      const rows = await client.query(
        `SELECT d.id, d.candidate_id, d.request_type, d.status, d.received_at, d.due_at, d.resolved_at,
                (d.due_at < now() AND d.resolved_at IS NULL) AS overdue,
                c.full_name AS candidate_name, c.email AS candidate_email
           FROM data_rights_requests d
           JOIN candidates c ON c.id = d.candidate_id
          ORDER BY d.due_at ASC LIMIT 200`,
      );
      return rows.rows;
    });
  });

  app.post(
    "/v1/orgs/:orgId/data-rights/:requestId/transition",
    { preHandler: adminRole },
    async (request, reply) => {
      const parsed = TransitionSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Invalid transition.", request.id);
      }
      const { requestId } = request.params as { requestId: string };
      const orgId = request.orgId!;
      const auth = request.auth!;
      try {
        const result = await withOrgTx(orgId, async (client) => {
          const row = await client.query<{
            status: DataRightsState;
            request_type: string;
            candidate_id: string;
          }>(
            "SELECT status, request_type, candidate_id FROM data_rights_requests WHERE id = $1 FOR UPDATE",
            [requestId],
          );
          const dsr = row.rows[0];
          if (!dsr) return { error: "NOT_FOUND" as const };
          const event = parsed.data.event as DataRightsEvent;
          const next = dataRightsMachine.next(dsr.status, event);

          let erasure: Record<string, number> | undefined;
          if (event === "fulfil" && dsr.request_type === "erasure") {
            erasure = await eraseCandidateData(client, orgId, dsr.candidate_id);
          }
          await client.query(
            `UPDATE data_rights_requests
                SET status = $1::data_rights_status,
                    resolved_at = CASE WHEN $1::text IN ('fulfilled','refused_documented','withdrawn_by_subject') THEN now() ELSE resolved_at END,
                    resolution_note = coalesce($2, resolution_note)
              WHERE id = $3`,
            [next, parsed.data.note ?? null, requestId],
          );
          await appendAudit(client, {
            organisationId: orgId,
            actorUserId: auth.userId,
            action: `data_rights.${event}`,
            entityType: "data_rights_request",
            entityId: requestId,
            metadata: erasure ? { erasure } : {},
          });
          return { status: next, ...(erasure ? { erasure } : {}) };
        });
        if ("error" in result) return sendError(reply, 404, "NOT_FOUND", "Request not found.", request.id);
        return result;
      } catch (error) {
        if (error instanceof InvalidTransitionError) {
          return sendError(reply, 409, "STATE_CONFLICT", error.message, request.id);
        }
        if (error instanceof LegalHoldActiveError) {
          return sendError(reply, 409, "LEGAL_HOLD_ACTIVE", error.message, request.id);
        }
        throw error;
      }
    },
  );

  /** Place / release legal holds (BR-10). */
  app.get("/v1/orgs/:orgId/legal-holds", { preHandler: adminRole }, async (request) => {
    const orgId = request.orgId!;
    return withOrgTx(orgId, async (client) => {
      const rows = await client.query(
        `SELECT h.id, h.candidate_id, h.reason, h.placed_at, h.released_at,
                c.full_name AS candidate_name, c.email AS candidate_email
           FROM legal_holds h
           JOIN candidates c ON c.id = h.candidate_id
          ORDER BY h.released_at IS NULL DESC, h.placed_at DESC LIMIT 200`,
      );
      return rows.rows;
    });
  });

  app.post("/v1/orgs/:orgId/legal-holds", { preHandler: adminRole }, async (request, reply) => {
    const schema = z.object({ candidateId: z.string().uuid(), reason: z.string().min(5).max(2_000) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "candidateId and reason are required.", request.id);
    }
    const orgId = request.orgId!;
    const auth = request.auth!;
    const row = await withOrgTx(orgId, async (client) => {
      const result = await client.query<{ id: string }>(
        "INSERT INTO legal_holds (organisation_id, candidate_id, reason) VALUES ($1, $2, $3) RETURNING id",
        [orgId, parsed.data.candidateId, parsed.data.reason],
      );
      await appendAudit(client, {
        organisationId: orgId,
        actorUserId: auth.userId,
        action: "compliance.legal_hold_placed",
        entityType: "legal_hold",
        entityId: result.rows[0]!.id,
        metadata: { candidateId: parsed.data.candidateId },
      });
      return result.rows[0]!;
    });
    return reply.status(201).send({ id: row.id });
  });

  app.post(
    "/v1/orgs/:orgId/legal-holds/:holdId/release",
    { preHandler: adminRole },
    async (request, reply) => {
      const { holdId } = request.params as { holdId: string };
      const orgId = request.orgId!;
      const auth = request.auth!;
      const released = await withOrgTx(orgId, async (client) => {
        const result = await client.query(
          "UPDATE legal_holds SET released_at = now() WHERE id = $1 AND released_at IS NULL",
          [holdId],
        );
        if ((result.rowCount ?? 0) > 0) {
          await appendAudit(client, {
            organisationId: orgId,
            actorUserId: auth.userId,
            action: "compliance.legal_hold_released",
            entityType: "legal_hold",
            entityId: holdId,
          });
        }
        return (result.rowCount ?? 0) > 0;
      });
      if (!released) return sendError(reply, 404, "NOT_FOUND", "Active legal hold not found.", request.id);
      return { released: true };
    },
  );

  /** Audit-chain verification for compliance operations. */
  app.get("/v1/orgs/:orgId/audit/verify-chain", { preHandler: adminRole }, async (request) => {
    const orgId = request.orgId!;
    return withOrgTx(orgId, async (client) => {
      const { verifyAuditChain } = await import("../../db/audit.js");
      return verifyAuditChain(client);
    });
  });
}
