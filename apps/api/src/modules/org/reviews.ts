import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  AssessmentTemplateSchema,
  ConfidenceLevel,
  evaluate,
  InvalidTransitionError,
  loadScoringModel,
  OversightIncompleteError,
  reviewMachine,
  sessionMachine,
  type CriterionAssessment,
  type ReviewState,
  type SessionState,
} from "@cpf/assessment-framework";
import { appendAudit } from "../../db/audit.js";
import { withOrgTx, type Queryable } from "../../db/pool.js";
import { requireOrgRole, sendError } from "../auth/guards.js";
import { requireResponsibleUseAck } from "./acknowledgements.js";

const AssignReviewSchema = z.object({ reviewerUserId: z.string().uuid() });

const ScoreSchema = z.object({
  scores: z
    .array(
      z.object({
        criterionId: z.string().min(1).max(20),
        reviewer1Score: z.number().int().min(1).max(5).optional(),
        reviewer2Score: z.number().int().min(1).max(5).optional(),
        adjudicatedScore: z.number().int().min(1).max(5).optional(),
        evidenceNote: z.string().max(10_000).optional(),
        confidence: ConfidenceLevel.optional(),
      }),
    )
    .min(1)
    .max(50),
});

const FinaliseSchema = z.object({
  rationale: z.string().min(20).max(20_000),
  confidence: ConfidenceLevel,
  limitations: z.string().min(10).max(20_000),
});

const reviewerRole = requireOrgRole("reviewer");
const managerRoles = requireOrgRole("org_admin", "hiring_manager");
const adminRole = requireOrgRole("org_admin");

interface StoredScoreRow {
  criterion_id: string;
  reviewer1_score: number | null;
  reviewer2_score: number | null;
  adjudicated_score: number | null;
  evidence_note: string | null;
  confidence: string | null;
}

function toAssessments(rows: StoredScoreRow[]): CriterionAssessment[] {
  return rows.map((r) => ({
    criterionId: r.criterion_id,
    ...(r.reviewer1_score != null ? { reviewer1Score: r.reviewer1_score } : {}),
    ...(r.reviewer2_score != null ? { reviewer2Score: r.reviewer2_score } : {}),
    ...(r.adjudicated_score != null ? { adjudicatedScore: r.adjudicated_score } : {}),
    ...(r.evidence_note != null ? { evidenceNote: r.evidence_note } : {}),
    ...(r.confidence != null ? { confidence: r.confidence as CriterionAssessment["confidence"] } : {}),
  }));
}

async function loadFrozenTemplate(client: Queryable, sessionId: string) {
  const rows = await client.query<{ definition: unknown }>(
    `SELECT v.definition FROM assessment_sessions s
       JOIN assessment_template_versions v ON v.id = s.template_version_id
      WHERE s.id = $1`,
    [sessionId],
  );
  if (!rows.rows[0]) return null;
  return AssessmentTemplateSchema.parse(rows.rows[0].definition);
}

export function registerReviewRoutes(app: FastifyInstance): void {
  /** Assign a calibrated reviewer to a submitted session (org admin). */
  app.post(
    "/v1/orgs/:orgId/sessions/:sessionId/reviews",
    { preHandler: adminRole },
    async (request, reply) => {
      const parsed = AssignReviewSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "reviewerUserId is required.", request.id);
      }
      const { sessionId } = request.params as { sessionId: string };
      const orgId = request.orgId!;
      const auth = request.auth!;
      try {
        const result = await withOrgTx(orgId, async (client) => {
          const membership = await client.query(
            "SELECT 1 FROM org_memberships WHERE organisation_id = $1 AND user_id = $2 AND role = 'reviewer'",
            [orgId, parsed.data.reviewerUserId],
          );
          if (membership.rowCount === 0) return { error: "NOT_A_REVIEWER" as const };
          const session = await client.query<{ status: SessionState }>(
            "SELECT status FROM assessment_sessions WHERE id = $1 FOR UPDATE",
            [sessionId],
          );
          if (!session.rows[0]) return { error: "NOT_FOUND" as const };
          const next = sessionMachine.next(session.rows[0].status, "begin_review");
          await client.query(
            "UPDATE assessment_sessions SET status = $1, updated_at = now() WHERE id = $2",
            [next, sessionId],
          );
          const review = await client.query<{ id: string }>(
            `INSERT INTO reviews (organisation_id, session_id, reviewer_user_id)
             VALUES ($1, $2, $3) RETURNING id`,
            [orgId, sessionId, parsed.data.reviewerUserId],
          );
          await appendAudit(client, {
            organisationId: orgId,
            actorUserId: auth.userId,
            action: "review.assigned",
            entityType: "review",
            entityId: review.rows[0]!.id,
            metadata: { sessionId, reviewerUserId: parsed.data.reviewerUserId },
          });
          return { reviewId: review.rows[0]!.id };
        });
        if ("error" in result) {
          if (result.error === "NOT_A_REVIEWER") {
            return sendError(reply, 422, "NOT_A_REVIEWER", "The user does not hold the reviewer role in this organisation.", request.id);
          }
          return sendError(reply, 404, "NOT_FOUND", "Session not found.", request.id);
        }
        return reply.status(201).send(result);
      } catch (error) {
        if (error instanceof InvalidTransitionError) {
          return sendError(reply, 409, "STATE_CONFLICT", error.message, request.id);
        }
        throw error;
      }
    },
  );

  /** Reviewer's queue. */
  app.get("/v1/orgs/:orgId/reviews/mine", { preHandler: reviewerRole }, async (request) => {
    const orgId = request.orgId!;
    const auth = request.auth!;
    return withOrgTx(orgId, async (client) => {
      const rows = await client.query(
        `SELECT r.id, r.status, r.created_at, r.session_id, s.submitted_at
           FROM reviews r JOIN assessment_sessions s ON s.id = r.session_id
          WHERE r.reviewer_user_id = $1
          ORDER BY r.created_at DESC LIMIT 100`,
        [auth.userId],
      );
      return rows.rows;
    });
  });

  /** Evidence for an assigned review (reviewer sees evidence; employers never do). */
  app.get(
    "/v1/orgs/:orgId/reviews/:reviewId/evidence",
    { preHandler: reviewerRole },
    async (request, reply) => {
      const { reviewId } = request.params as { reviewId: string };
      const orgId = request.orgId!;
      const auth = request.auth!;
      return withOrgTx(orgId, async (client) => {
        const review = await client.query<{ session_id: string; reviewer_user_id: string }>(
          "SELECT session_id, reviewer_user_id FROM reviews WHERE id = $1",
          [reviewId],
        );
        const row = review.rows[0];
        if (!row || row.reviewer_user_id !== auth.userId) {
          return sendError(reply, 404, "NOT_FOUND", "Review not found.", request.id);
        }
        // Integrity signals are returned as a SEPARATE collection with guidance (C-05).
        const events = await client.query(
          `SELECT id, category, event_type, payload, occurred_at
             FROM evidence_events WHERE session_id = $1 ORDER BY occurred_at ASC LIMIT 5000`,
          [row.session_id],
        );
        const template = await loadFrozenTemplate(client, row.session_id);
        return {
          template: template
            ? { code: template.code, title: template.title, criteria: template.criteria, reviewerInstruction: template.reviewerInstruction }
            : null,
          workspaceEvidence: events.rows.filter((e) => e.category === "workspace_evidence"),
          integrityContext: {
            guidance:
              "Integrity signals inform your review; they never determine an outcome. Interpret contextually and separately from capability evidence.",
            signals: events.rows.filter((e) => e.category === "integrity_signal"),
          },
        };
      });
    },
  );

  /** Upsert criterion scores (validated against the frozen template version). */
  app.put(
    "/v1/orgs/:orgId/reviews/:reviewId/scores",
    { preHandler: reviewerRole },
    async (request, reply) => {
      const parsed = ScoreSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Invalid scores payload.", request.id);
      }
      const { reviewId } = request.params as { reviewId: string };
      const orgId = request.orgId!;
      const auth = request.auth!;
      try {
        const result = await withOrgTx(orgId, async (client) => {
          const review = await client.query<{ session_id: string; reviewer_user_id: string; status: ReviewState }>(
            "SELECT session_id, reviewer_user_id, status FROM reviews WHERE id = $1 FOR UPDATE",
            [reviewId],
          );
          const row = review.rows[0];
          if (!row || row.reviewer_user_id !== auth.userId) return { error: "NOT_FOUND" as const };
          if (row.status === "assigned") {
            await client.query("UPDATE reviews SET status = $1 WHERE id = $2", [
              reviewMachine.next("assigned", "begin"),
              reviewId,
            ]);
          } else if (row.status === "finalised") {
            return { error: "FINALISED" as const };
          }
          const template = (await loadFrozenTemplate(client, row.session_id))!;
          const known = new Set(template.criteria.map((c) => c.id));
          for (const score of parsed.data.scores) {
            if (!known.has(score.criterionId)) {
              return { error: "UNKNOWN_CRITERION" as const, criterionId: score.criterionId };
            }
          }
          for (const score of parsed.data.scores) {
            await client.query(
              `INSERT INTO criterion_scores
                 (organisation_id, review_id, criterion_id, reviewer1_score, reviewer2_score, adjudicated_score, evidence_note, confidence)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT (review_id, criterion_id) DO UPDATE SET
                 reviewer1_score = EXCLUDED.reviewer1_score,
                 reviewer2_score = EXCLUDED.reviewer2_score,
                 adjudicated_score = EXCLUDED.adjudicated_score,
                 evidence_note = EXCLUDED.evidence_note,
                 confidence = EXCLUDED.confidence,
                 updated_at = now()`,
              [
                orgId,
                reviewId,
                score.criterionId,
                score.reviewer1Score ?? null,
                score.reviewer2Score ?? null,
                score.adjudicatedScore ?? null,
                score.evidenceNote ?? null,
                score.confidence ?? null,
              ],
            );
          }
          await appendAudit(client, {
            organisationId: orgId,
            actorUserId: auth.userId,
            action: "review.scores_saved",
            entityType: "review",
            entityId: reviewId,
            metadata: { criteria: parsed.data.scores.map((s) => s.criterionId) },
          });
          return { saved: parsed.data.scores.length };
        });
        if ("error" in result) {
          if (result.error === "NOT_FOUND") return sendError(reply, 404, "NOT_FOUND", "Review not found.", request.id);
          if (result.error === "FINALISED") return sendError(reply, 409, "STATE_CONFLICT", "A finalised review is immutable. Reopen it to make changes.", request.id);
          return sendError(reply, 422, "SCORING_INPUT_INVALID", `Criterion ${result.criterionId} does not exist in the frozen template version.`, request.id);
        }
        return result;
      } catch (error) {
        if (error instanceof InvalidTransitionError) {
          return sendError(reply, 409, "STATE_CONFLICT", error.message, request.id);
        }
        throw error;
      }
    },
  );

  /** Live decision-support preview for the reviewer (same engine as the profile). */
  app.get(
    "/v1/orgs/:orgId/reviews/:reviewId/preview",
    { preHandler: reviewerRole },
    async (request, reply) => {
      const { reviewId } = request.params as { reviewId: string };
      const orgId = request.orgId!;
      const auth = request.auth!;
      return withOrgTx(orgId, async (client) => {
        const review = await client.query<{ session_id: string; reviewer_user_id: string }>(
          "SELECT session_id, reviewer_user_id FROM reviews WHERE id = $1",
          [reviewId],
        );
        const row = review.rows[0];
        if (!row || row.reviewer_user_id !== auth.userId) {
          return sendError(reply, 404, "NOT_FOUND", "Review not found.", request.id);
        }
        const template = (await loadFrozenTemplate(client, row.session_id))!;
        const scores = await client.query<StoredScoreRow>(
          "SELECT criterion_id, reviewer1_score, reviewer2_score, adjudicated_score, evidence_note, confidence FROM criterion_scores WHERE review_id = $1",
          [reviewId],
        );
        return evaluate(template, loadScoringModel(), toAssessments(scores.rows));
      });
    },
  );

  /**
   * GUARDRAIL BR-02: finalisation requires rationale + confidence + limitations,
   * and unresolved adjudications block completion.
   */
  app.post(
    "/v1/orgs/:orgId/reviews/:reviewId/finalise",
    { preHandler: reviewerRole },
    async (request, reply) => {
      const parsed = FinaliseSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 422, "OVERSIGHT_INCOMPLETE", "Finalisation requires rationale (≥20 chars), confidence, and limitations (≥10 chars).", request.id);
      }
      const { reviewId } = request.params as { reviewId: string };
      const orgId = request.orgId!;
      const auth = request.auth!;
      try {
        const result = await withOrgTx(orgId, async (client) => {
          const review = await client.query<{ session_id: string; reviewer_user_id: string; status: ReviewState }>(
            "SELECT session_id, reviewer_user_id, status FROM reviews WHERE id = $1 FOR UPDATE",
            [reviewId],
          );
          const row = review.rows[0];
          if (!row || row.reviewer_user_id !== auth.userId) return { error: "NOT_FOUND" as const };
          reviewMachine.next(row.status, "finalise"); // validates state; throws on bad flow
          const template = (await loadFrozenTemplate(client, row.session_id))!;
          const scores = await client.query<StoredScoreRow>(
            "SELECT criterion_id, reviewer1_score, reviewer2_score, adjudicated_score, evidence_note, confidence FROM criterion_scores WHERE review_id = $1",
            [reviewId],
          );
          const profile = evaluate(template, loadScoringModel(), toAssessments(scores.rows));
          if (profile.adjudicationsRequired.length > 0) {
            return { error: "ADJUDICATION_REQUIRED" as const, criteria: profile.adjudicationsRequired };
          }
          await client.query(
            `UPDATE reviews SET status = 'finalised', final_rationale = $1, confidence = $2,
                    limitations = $3, finalised_at = now() WHERE id = $4`,
            [parsed.data.rationale, parsed.data.confidence, parsed.data.limitations, reviewId],
          );
          const sessionNext = sessionMachine.next(
            (await client.query<{ status: SessionState }>("SELECT status FROM assessment_sessions WHERE id = $1 FOR UPDATE", [row.session_id])).rows[0]!.status,
            "finalise_review",
          );
          await client.query("UPDATE assessment_sessions SET status = $1, updated_at = now() WHERE id = $2", [sessionNext, row.session_id]);
          await client.query(
            `INSERT INTO evidence_events (organisation_id, session_id, category, event_type, payload)
             VALUES ($1, $2, 'reviewer_decision', 'review_finalised', $3)`,
            [orgId, row.session_id, JSON.stringify({ reviewId, confidence: parsed.data.confidence })],
          );
          await appendAudit(client, {
            organisationId: orgId,
            actorUserId: auth.userId,
            action: "review.finalised",
            entityType: "review",
            entityId: reviewId,
            metadata: { sessionId: row.session_id, decisionSupportRoute: profile.decisionSupportRoute },
          });
          return { finalised: true, decisionSupportRoute: profile.decisionSupportRoute };
        });
        if ("error" in result) {
          if (result.error === "NOT_FOUND") return sendError(reply, 404, "NOT_FOUND", "Review not found.", request.id);
          const criteria = result.criteria ?? [];
          return sendError(reply, 422, "ADJUDICATION_REQUIRED", `Reviewer variance must be adjudicated before finalisation: ${criteria.join(", ")}.`, request.id);
        }
        return result;
      } catch (error) {
        if (error instanceof InvalidTransitionError || error instanceof OversightIncompleteError) {
          return sendError(reply, 409, "STATE_CONFLICT", error.message, request.id);
        }
        throw error;
      }
    },
  );

  /** Issue the report to the employer — only possible after review finalisation. */
  app.post(
    "/v1/orgs/:orgId/sessions/:sessionId/issue-report",
    { preHandler: managerRoles },
    async (request, reply) => {
      const { sessionId } = request.params as { sessionId: string };
      const orgId = request.orgId!;
      const auth = request.auth!;
      try {
        const result = await withOrgTx(orgId, async (client) => {
          const session = await client.query<{ status: SessionState }>(
            "SELECT status FROM assessment_sessions WHERE id = $1 FOR UPDATE",
            [sessionId],
          );
          if (!session.rows[0]) return { error: "NOT_FOUND" as const };
          const next = sessionMachine.next(session.rows[0].status, "issue_report");
          await client.query("UPDATE assessment_sessions SET status = $1, updated_at = now() WHERE id = $2", [next, sessionId]);
          await appendAudit(client, {
            organisationId: orgId,
            actorUserId: auth.userId,
            action: "report.issued",
            entityType: "assessment_session",
            entityId: sessionId,
          });
          return { status: next };
        });
        if ("error" in result) return sendError(reply, 404, "NOT_FOUND", "Session not found.", request.id);
        return result;
      } catch (error) {
        if (error instanceof InvalidTransitionError) {
          return sendError(reply, 409, "STATE_CONFLICT", error.message, request.id);
        }
        throw error;
      }
    },
  );

  /**
   * The employer-facing Evidence Profile. Bands, claims, probes, reviewer
   * rationale — never raw evidence, never integrity streams, never a verdict.
   */
  app.get(
    "/v1/orgs/:orgId/sessions/:sessionId/evidence-profile",
    { preHandler: managerRoles },
    async (request, reply) => {
      const { sessionId } = request.params as { sessionId: string };
      const orgId = request.orgId!;
      const auth = request.auth!;
      return withOrgTx(orgId, async (client) => {
        const session = await client.query<{ status: string; accommodations_note: string | null }>(
          "SELECT status, accommodations_note FROM assessment_sessions WHERE id = $1",
          [sessionId],
        );
        const sessionRow = session.rows[0];
        if (!sessionRow) return sendError(reply, 404, "NOT_FOUND", "Session not found.", request.id);
        if (!(await requireResponsibleUseAck(client, orgId, auth.userId))) {
          return sendError(
            reply,
            428,
            "ACKNOWLEDGEMENT_REQUIRED",
            "Acknowledge the responsible-use document before viewing an Evidence Profile.",
            request.id,
          );
        }
        if (sessionRow.status !== "report_issued") {
          return sendError(reply, 409, "REPORT_NOT_ISSUED", "The evidence profile becomes available after the report is issued.", request.id);
        }
        const review = await client.query<{
          id: string;
          final_rationale: string;
          confidence: string;
          limitations: string;
          finalised_at: Date;
        }>(
          "SELECT id, final_rationale, confidence, limitations, finalised_at FROM reviews WHERE session_id = $1 AND status = 'finalised' ORDER BY finalised_at DESC LIMIT 1",
          [sessionId],
        );
        const reviewRow = review.rows[0]!;
        const template = (await loadFrozenTemplate(client, sessionId))!;
        const scores = await client.query<StoredScoreRow>(
          "SELECT criterion_id, reviewer1_score, reviewer2_score, adjudicated_score, evidence_note, confidence FROM criterion_scores WHERE review_id = $1",
          [reviewRow.id],
        );
        const profile = evaluate(template, loadScoringModel(), toAssessments(scores.rows));
        const probes = template.criteria.map((c) => ({ criterionId: c.id, probe: c.interviewProbe }));
        // Employer access is itself evidence (accountability).
        await client.query(
          `INSERT INTO evidence_events (organisation_id, session_id, category, event_type, payload)
           VALUES ($1, $2, 'employer_access', 'evidence_profile_viewed', $3)`,
          [orgId, sessionId, JSON.stringify({ viewedBy: auth.userId })],
        );
        await appendAudit(client, {
          organisationId: orgId,
          actorUserId: auth.userId,
          action: "report.viewed",
          entityType: "assessment_session",
          entityId: sessionId,
        });
        return {
          reviewerSummary: {
            rationale: reviewRow.final_rationale,
            confidence: reviewRow.confidence,
            limitations: reviewRow.limitations,
            finalisedAt: reviewRow.finalised_at,
          },
          accommodationsNote: sessionRow.accommodations_note,
          dimensions: profile.dimensions,
          criticalConcerns: profile.criticalConcerns,
          decisionSupportRoute: profile.decisionSupportRoute,
          interviewProbes: probes,
          governanceNote: profile.governanceNote,
        };
      });
    },
  );
}
