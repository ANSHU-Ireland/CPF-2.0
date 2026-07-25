import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  CollaborationDimension,
  EvidenceBand,
  ReviewerConfidence,
  checkBandRule,
} from "@cpf/assessment-framework";
import { appendAudit } from "../../db/audit.js";
import { withOrgTx, type Queryable } from "../../db/pool.js";
import { requireOrgRole, sendError } from "../auth/guards.js";

const reviewerRole = requireOrgRole("reviewer");

const ClaimSchema = z.object({
  dimension: CollaborationDimension,
  claim: z.string().min(5).max(5_000),
  evidenceBand: EvidenceBand,
  evidenceReferences: z.array(z.string().regex(/^\d+$/, "must be an evidence event id")).max(20).default([]),
  counterEvidence: z.string().max(5_000).optional(),
  reviewerConfidence: ReviewerConfidence,
  limitations: z.string().max(5_000).optional(),
  rationale: z.string().min(10).max(5_000),
});

type ClaimMutationError =
  | { error: "NOT_FOUND" }
  | { error: "FINALISED" }
  | { error: "UNKNOWN_EVIDENCE_REFERENCE" }
  | { error: "BAND_RULE_VIOLATION"; message: string };

interface ClaimRow {
  id: string;
  dimension: string;
  claim: string;
  evidence_band: string;
  evidence_references: string[];
  counter_evidence: string | null;
  reviewer_confidence: string;
  limitations: string | null;
  reviewer_rationale: string;
  created_at: Date;
}

function toClaimResponse(row: ClaimRow) {
  return {
    id: row.id,
    dimension: row.dimension,
    claim: row.claim,
    evidenceBand: row.evidence_band,
    evidenceReferences: row.evidence_references,
    counterEvidence: row.counter_evidence,
    reviewerConfidence: row.reviewer_confidence,
    limitations: row.limitations,
    rationale: row.reviewer_rationale,
    createdAt: row.created_at,
  };
}

/** Loads the review row and enforces reviewer-only, own-review access. */
async function loadOwnReview(
  client: Queryable,
  reviewId: string,
  reviewerUserId: string,
): Promise<{ sessionId: string; status: string } | null> {
  const review = await client.query<{ session_id: string; reviewer_user_id: string; status: string }>(
    "SELECT session_id, reviewer_user_id, status FROM reviews WHERE id = $1 FOR UPDATE",
    [reviewId],
  );
  const row = review.rows[0];
  if (!row || row.reviewer_user_id !== reviewerUserId) return null;
  return { sessionId: row.session_id, status: row.status };
}

/** Validates that every referenced id is a real evidence event belonging to this session. */
async function validateEvidenceReferences(
  client: Queryable,
  sessionId: string,
  ids: string[],
): Promise<boolean> {
  if (ids.length === 0) return true;
  const result = await client.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM evidence_events WHERE session_id = $1 AND id = ANY($2::bigint[])",
    [sessionId, ids],
  );
  return (result.rows[0]?.n ?? 0) === ids.length;
}

export function registerClaimsRoutes(app: FastifyInstance): void {
  /** List Evidence Ledger claims for a review (reviewer-only, own review). */
  app.get(
    "/v1/orgs/:orgId/reviews/:reviewId/claims",
    { preHandler: reviewerRole },
    async (request, reply) => {
      const { reviewId } = request.params as { reviewId: string };
      const orgId = request.orgId!;
      const auth = request.auth!;
      return withOrgTx(orgId, async (client) => {
        const review = await loadOwnReview(client, reviewId, auth.userId);
        if (!review) return sendError(reply, 404, "NOT_FOUND", "Review not found.", request.id);
        const rows = await client.query<ClaimRow>(
          "SELECT id, dimension, claim, evidence_band, evidence_references, counter_evidence, reviewer_confidence, limitations, reviewer_rationale, created_at FROM evidence_ledger_claims WHERE review_id = $1 ORDER BY created_at ASC",
          [reviewId],
        );
        return rows.rows.map(toClaimResponse);
      });
    },
  );

  /** Create an Evidence Ledger claim (reviewer-only, own review, not finalised). */
  app.post(
    "/v1/orgs/:orgId/reviews/:reviewId/claims",
    { preHandler: reviewerRole },
    async (request, reply) => {
      const parsed = ClaimSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Invalid claim payload.", request.id);
      }
      const { reviewId } = request.params as { reviewId: string };
      const orgId = request.orgId!;
      const auth = request.auth!;
      const result = await withOrgTx<ClaimMutationError | { claim: ReturnType<typeof toClaimResponse> }>(orgId, async (client) => {
        const review = await loadOwnReview(client, reviewId, auth.userId);
        if (!review) return { error: "NOT_FOUND" };
        if (review.status === "finalised") return { error: "FINALISED" };
        const refsOk = await validateEvidenceReferences(client, review.sessionId, parsed.data.evidenceReferences);
        if (!refsOk) return { error: "UNKNOWN_EVIDENCE_REFERENCE" };
        const ruleViolation = checkBandRule(parsed.data.evidenceBand, {
          evidenceReferenceCount: parsed.data.evidenceReferences.length,
          reviewerConfidence: parsed.data.reviewerConfidence,
          counterEvidence: parsed.data.counterEvidence,
          limitations: parsed.data.limitations,
        });
        if (ruleViolation) return { error: "BAND_RULE_VIOLATION", message: ruleViolation };
        const row = await client.query<ClaimRow>(
          `INSERT INTO evidence_ledger_claims
             (organisation_id, review_id, dimension, claim, evidence_band, evidence_references, counter_evidence, reviewer_confidence, limitations, reviewer_rationale)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id, dimension, claim, evidence_band, evidence_references, counter_evidence, reviewer_confidence, limitations, reviewer_rationale, created_at`,
          [
            orgId,
            reviewId,
            parsed.data.dimension,
            parsed.data.claim,
            parsed.data.evidenceBand,
            JSON.stringify(parsed.data.evidenceReferences),
            parsed.data.counterEvidence ?? null,
            parsed.data.reviewerConfidence,
            parsed.data.limitations ?? null,
            parsed.data.rationale,
          ],
        );
        await appendAudit(client, {
          organisationId: orgId,
          actorUserId: auth.userId,
          action: "review.claim_created",
          entityType: "evidence_ledger_claim",
          entityId: row.rows[0]!.id,
          metadata: { reviewId, dimension: parsed.data.dimension, evidenceBand: parsed.data.evidenceBand },
        });
        return { claim: toClaimResponse(row.rows[0]!) };
      });
      if ("error" in result) {
        if (result.error === "NOT_FOUND") return sendError(reply, 404, "NOT_FOUND", "Review not found.", request.id);
        if (result.error === "FINALISED") {
          return sendError(reply, 409, "STATE_CONFLICT", "A finalised review is immutable. Reopen it to make changes.", request.id);
        }
        if (result.error === "UNKNOWN_EVIDENCE_REFERENCE") {
          return sendError(reply, 422, "UNKNOWN_EVIDENCE_REFERENCE", "One or more evidence references do not belong to this session.", request.id);
        }
        return sendError(reply, 422, "BAND_RULE_VIOLATION", result.message, request.id);
      }
      return reply.status(201).send(result.claim);
    },
  );

  /** Update an Evidence Ledger claim (reviewer-only, own review, not finalised). */
  app.put(
    "/v1/orgs/:orgId/reviews/:reviewId/claims/:claimId",
    { preHandler: reviewerRole },
    async (request, reply) => {
      const parsed = ClaimSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Invalid claim payload.", request.id);
      }
      const { reviewId, claimId } = request.params as { reviewId: string; claimId: string };
      const orgId = request.orgId!;
      const auth = request.auth!;
      const result = await withOrgTx<ClaimMutationError | { claim: ReturnType<typeof toClaimResponse> }>(orgId, async (client) => {
        const review = await loadOwnReview(client, reviewId, auth.userId);
        if (!review) return { error: "NOT_FOUND" };
        if (review.status === "finalised") return { error: "FINALISED" };
        const refsOk = await validateEvidenceReferences(client, review.sessionId, parsed.data.evidenceReferences);
        if (!refsOk) return { error: "UNKNOWN_EVIDENCE_REFERENCE" };
        const ruleViolation = checkBandRule(parsed.data.evidenceBand, {
          evidenceReferenceCount: parsed.data.evidenceReferences.length,
          reviewerConfidence: parsed.data.reviewerConfidence,
          counterEvidence: parsed.data.counterEvidence,
          limitations: parsed.data.limitations,
        });
        if (ruleViolation) return { error: "BAND_RULE_VIOLATION", message: ruleViolation };
        const row = await client.query<ClaimRow>(
          `UPDATE evidence_ledger_claims SET
             dimension = $1, claim = $2, evidence_band = $3, evidence_references = $4,
             counter_evidence = $5, reviewer_confidence = $6, limitations = $7, reviewer_rationale = $8
           WHERE id = $9 AND review_id = $10
           RETURNING id, dimension, claim, evidence_band, evidence_references, counter_evidence, reviewer_confidence, limitations, reviewer_rationale, created_at`,
          [
            parsed.data.dimension,
            parsed.data.claim,
            parsed.data.evidenceBand,
            JSON.stringify(parsed.data.evidenceReferences),
            parsed.data.counterEvidence ?? null,
            parsed.data.reviewerConfidence,
            parsed.data.limitations ?? null,
            parsed.data.rationale,
            claimId,
            reviewId,
          ],
        );
        if (!row.rows[0]) return { error: "NOT_FOUND" as const };
        await appendAudit(client, {
          organisationId: orgId,
          actorUserId: auth.userId,
          action: "review.claim_updated",
          entityType: "evidence_ledger_claim",
          entityId: claimId,
          metadata: { reviewId },
        });
        return { claim: toClaimResponse(row.rows[0]) };
      });
      if ("error" in result) {
        if (result.error === "NOT_FOUND") return sendError(reply, 404, "NOT_FOUND", "Claim not found.", request.id);
        if (result.error === "FINALISED") {
          return sendError(reply, 409, "STATE_CONFLICT", "A finalised review is immutable. Reopen it to make changes.", request.id);
        }
        if (result.error === "UNKNOWN_EVIDENCE_REFERENCE") {
          return sendError(reply, 422, "UNKNOWN_EVIDENCE_REFERENCE", "One or more evidence references do not belong to this session.", request.id);
        }
        return sendError(reply, 422, "BAND_RULE_VIOLATION", result.message, request.id);
      }
      return result.claim;
    },
  );

  /** Delete an Evidence Ledger claim (reviewer-only, own review, not finalised). */
  app.delete(
    "/v1/orgs/:orgId/reviews/:reviewId/claims/:claimId",
    { preHandler: reviewerRole },
    async (request, reply) => {
      const { reviewId, claimId } = request.params as { reviewId: string; claimId: string };
      const orgId = request.orgId!;
      const auth = request.auth!;
      const result = await withOrgTx(orgId, async (client) => {
        const review = await loadOwnReview(client, reviewId, auth.userId);
        if (!review) return { error: "NOT_FOUND" as const };
        if (review.status === "finalised") return { error: "FINALISED" as const };
        const deleted = await client.query("DELETE FROM evidence_ledger_claims WHERE id = $1 AND review_id = $2", [
          claimId,
          reviewId,
        ]);
        if ((deleted.rowCount ?? 0) === 0) return { error: "NOT_FOUND" as const };
        await appendAudit(client, {
          organisationId: orgId,
          actorUserId: auth.userId,
          action: "review.claim_deleted",
          entityType: "evidence_ledger_claim",
          entityId: claimId,
          metadata: { reviewId },
        });
        return { deleted: true };
      });
      if ("error" in result) {
        if (result.error === "NOT_FOUND") return sendError(reply, 404, "NOT_FOUND", "Claim not found.", request.id);
        return sendError(reply, 409, "STATE_CONFLICT", "A finalised review is immutable. Reopen it to make changes.", request.id);
      }
      return result;
    },
  );
}
