import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  AssessmentTemplateSchema,
  ConfidenceLevel,
  EVIDENCE_BANDS,
  COLLABORATION_DIMENSIONS,
  evaluate,
  InvalidTransitionError,
  loadScoringModel,
  OversightIncompleteError,
  reviewMachine,
  sessionMachine,
  type CriterionAssessment,
  type EvidenceBand,
  type ReviewState,
  type SessionState,
} from "@cpf/assessment-framework";
import { appendAudit } from "../../db/audit.js";
import { withOrgTx, type Queryable } from "../../db/pool.js";
import { requireModuleEntitlement, requireOrgRole, sendError } from "../auth/guards.js";
import { requireResponsibleUseAck } from "./acknowledgements.js";
import { checkReviewerCalibrated } from "./calibration.js";

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

const reviewerRole = [requireOrgRole("reviewer"), requireModuleEntitlement("assessments")];
const managerRoles = [requireOrgRole("org_admin", "hiring_manager"), requireModuleEntitlement("assessments")];
const adminRole = [requireOrgRole("org_admin"), requireModuleEntitlement("assessments")];
const scoreWriteRole = [requireOrgRole("reviewer", "org_admin"), requireModuleEntitlement("assessments")];

const AssignSecondReviewerSchema = z.object({ reviewerUserId: z.string().uuid() });

type ScoreMutationError =
  | { error: "NOT_FOUND" }
  | { error: "FINALISED" }
  | { error: "FORBIDDEN_FIELD" }
  | { error: "UNKNOWN_CRITERION"; criterionId: string }
  | { error: "ADJUDICATION_SCORE_PREMATURE"; criterionId: string };


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

async function loadFrameworkVersionForSession(client: Queryable, sessionId: string): Promise<string | null> {
  const rows = await client.query<{ framework_version: string }>(
    `SELECT v.framework_version FROM assessment_sessions s
       JOIN assessment_template_versions v ON v.id = s.template_version_id
      WHERE s.id = $1`,
    [sessionId],
  );
  return rows.rows[0]?.framework_version ?? null;
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
          const session = await client.query<{ status: SessionState; template_version_id: string }>(
            "SELECT status, template_version_id FROM assessment_sessions WHERE id = $1 FOR UPDATE",
            [sessionId],
          );
          if (!session.rows[0]) return { error: "NOT_FOUND" as const };
          const frameworkVersion = await loadFrameworkVersionForSession(client, sessionId);
          if (!frameworkVersion) return { error: "NOT_FOUND" as const };
          const calibration = await checkReviewerCalibrated(client, orgId, parsed.data.reviewerUserId, frameworkVersion);
          if (calibration === "NOT_CALIBRATED") return { error: "REVIEWER_NOT_CALIBRATED" as const };
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
          if (result.error === "REVIEWER_NOT_CALIBRATED") {
            return sendError(
              reply,
              422,
              "REVIEWER_NOT_CALIBRATED",
              "The reviewer does not hold a valid calibration record for this template's framework version.",
              request.id,
            );
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

  /**
   * Assign a second reviewer to an existing review (org admin). Enables the
   * engine's double-scoring/adjudication path. Sample 20–30% of reviews per
   * the calibration protocol; not enforced server-side (guidance only).
   */
  app.post(
    "/v1/orgs/:orgId/reviews/:reviewId/second-reviewer",
    { preHandler: adminRole },
    async (request, reply) => {
      const parsed = AssignSecondReviewerSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "reviewerUserId is required.", request.id);
      }
      const { reviewId } = request.params as { reviewId: string };
      const orgId = request.orgId!;
      const auth = request.auth!;
      const result = await withOrgTx(orgId, async (client) => {
        const review = await client.query<{ session_id: string; reviewer_user_id: string; status: ReviewState }>(
          "SELECT session_id, reviewer_user_id, status FROM reviews WHERE id = $1 FOR UPDATE",
          [reviewId],
        );
        const row = review.rows[0];
        if (!row) return { error: "NOT_FOUND" as const };
        if (row.status === "finalised") return { error: "FINALISED" as const };
        if (parsed.data.reviewerUserId === row.reviewer_user_id) return { error: "SAME_REVIEWER" as const };
        const membership = await client.query(
          "SELECT 1 FROM org_memberships WHERE organisation_id = $1 AND user_id = $2 AND role = 'reviewer'",
          [orgId, parsed.data.reviewerUserId],
        );
        if (membership.rowCount === 0) return { error: "NOT_A_REVIEWER" as const };
        const frameworkVersion = await loadFrameworkVersionForSession(client, row.session_id);
        if (!frameworkVersion) return { error: "NOT_FOUND" as const };
        const calibration = await checkReviewerCalibrated(client, orgId, parsed.data.reviewerUserId, frameworkVersion);
        if (calibration === "NOT_CALIBRATED") return { error: "REVIEWER_NOT_CALIBRATED" as const };
        await client.query("UPDATE reviews SET second_reviewer_user_id = $1 WHERE id = $2", [
          parsed.data.reviewerUserId,
          reviewId,
        ]);
        await appendAudit(client, {
          organisationId: orgId,
          actorUserId: auth.userId,
          action: "review.second_reviewer_assigned",
          entityType: "review",
          entityId: reviewId,
          metadata: { reviewerUserId: parsed.data.reviewerUserId },
        });
        return { ok: true as const };
      });
      if ("error" in result) {
        if (result.error === "NOT_A_REVIEWER") {
          return sendError(reply, 422, "NOT_A_REVIEWER", "The user does not hold the reviewer role in this organisation.", request.id);
        }
        if (result.error === "REVIEWER_NOT_CALIBRATED") {
          return sendError(
            reply,
            422,
            "REVIEWER_NOT_CALIBRATED",
            "The reviewer does not hold a valid calibration record for this template's framework version.",
            request.id,
          );
        }
        if (result.error === "SAME_REVIEWER") {
          return sendError(reply, 422, "SAME_REVIEWER", "The second reviewer must be a different person from the first reviewer.", request.id);
        }
        if (result.error === "FINALISED") {
          return sendError(reply, 409, "STATE_CONFLICT", "A finalised review is immutable.", request.id);
        }
        return sendError(reply, 404, "NOT_FOUND", "Review not found.", request.id);
      }
      return reply.status(201).send(result);
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
        const review = await client.query<{ session_id: string; reviewer_user_id: string; second_reviewer_user_id: string | null }>(
          "SELECT session_id, reviewer_user_id, second_reviewer_user_id FROM reviews WHERE id = $1",
          [reviewId],
        );
        const row = review.rows[0];
        if (!row || (row.reviewer_user_id !== auth.userId && row.second_reviewer_user_id !== auth.userId)) {
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
    { preHandler: scoreWriteRole },
    async (request, reply) => {
      const parsed = ScoreSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Invalid scores payload.", request.id);
      }
      const { reviewId } = request.params as { reviewId: string };
      const orgId = request.orgId!;
      const auth = request.auth!;
      try {
        const result = await withOrgTx<ScoreMutationError | { saved: number }>(orgId, async (client) => {
          const review = await client.query<{
            session_id: string;
            reviewer_user_id: string;
            second_reviewer_user_id: string | null;
            status: ReviewState;
          }>(
            "SELECT session_id, reviewer_user_id, second_reviewer_user_id, status FROM reviews WHERE id = $1 FOR UPDATE",
            [reviewId],
          );
          const row = review.rows[0];
          if (!row) return { error: "NOT_FOUND" as const };
          let actor: "reviewer1" | "reviewer2" | "admin";
          if (auth.userId === row.reviewer_user_id) {
            actor = "reviewer1";
          } else if (row.second_reviewer_user_id && auth.userId === row.second_reviewer_user_id) {
            actor = "reviewer2";
          } else if (auth.memberships.some((m) => m.organisationId === orgId && m.role === "org_admin")) {
            actor = "admin";
          } else {
            return { error: "NOT_FOUND" as const };
          }
          if (row.status === "assigned" && actor === "reviewer1") {
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
            if (actor === "reviewer1" && (score.reviewer2Score !== undefined || score.adjudicatedScore !== undefined)) {
              return { error: "FORBIDDEN_FIELD" as const };
            }
            if (actor === "reviewer2" && (score.reviewer1Score !== undefined || score.adjudicatedScore !== undefined)) {
              return { error: "FORBIDDEN_FIELD" as const };
            }
            if (actor === "admin" && (score.reviewer1Score !== undefined || score.reviewer2Score !== undefined)) {
              return { error: "FORBIDDEN_FIELD" as const };
            }
          }
          if (actor === "admin") {
            const existing = await client.query<{ criterion_id: string; reviewer1_score: number | null; reviewer2_score: number | null }>(
              "SELECT criterion_id, reviewer1_score, reviewer2_score FROM criterion_scores WHERE review_id = $1",
              [reviewId],
            );
            const byId = new Map(existing.rows.map((r) => [r.criterion_id, r]));
            for (const score of parsed.data.scores) {
              if (score.adjudicatedScore === undefined) continue;
              const ex = byId.get(score.criterionId);
              if (!ex || ex.reviewer1_score === null || ex.reviewer2_score === null) {
                return { error: "ADJUDICATION_SCORE_PREMATURE" as const, criterionId: score.criterionId };
              }
            }
          }
          for (const score of parsed.data.scores) {
            await client.query(
              `INSERT INTO criterion_scores (organisation_id, review_id, criterion_id)
               VALUES ($1, $2, $3) ON CONFLICT (review_id, criterion_id) DO NOTHING`,
              [orgId, reviewId, score.criterionId],
            );
            if (actor === "reviewer1") {
              await client.query(
                `UPDATE criterion_scores SET reviewer1_score = $1, evidence_note = $2, confidence = $3, updated_at = now()
                 WHERE review_id = $4 AND criterion_id = $5`,
                [score.reviewer1Score ?? null, score.evidenceNote ?? null, score.confidence ?? null, reviewId, score.criterionId],
              );
            } else if (actor === "reviewer2") {
              await client.query(
                `UPDATE criterion_scores SET reviewer2_score = $1, evidence_note = $2, confidence = $3, updated_at = now()
                 WHERE review_id = $4 AND criterion_id = $5`,
                [score.reviewer2Score ?? null, score.evidenceNote ?? null, score.confidence ?? null, reviewId, score.criterionId],
              );
            } else {
              await client.query(
                `UPDATE criterion_scores SET adjudicated_score = $1, updated_at = now()
                 WHERE review_id = $2 AND criterion_id = $3`,
                [score.adjudicatedScore ?? null, reviewId, score.criterionId],
              );
            }
          }
          await appendAudit(client, {
            organisationId: orgId,
            actorUserId: auth.userId,
            action: "review.scores_saved",
            entityType: "review",
            entityId: reviewId,
            metadata: { criteria: parsed.data.scores.map((s) => s.criterionId), actor },
          });
          return { saved: parsed.data.scores.length };
        });
        if ("error" in result) {
          if (result.error === "NOT_FOUND") return sendError(reply, 404, "NOT_FOUND", "Review not found.", request.id);
          if (result.error === "FORBIDDEN_FIELD") {
            return sendError(reply, 403, "FORBIDDEN", "You may only write the score fields that belong to your role on this review.", request.id);
          }
          if (result.error === "ADJUDICATION_SCORE_PREMATURE") {
            return sendError(reply, 422, "ADJUDICATION_SCORE_PREMATURE", `Criterion ${result.criterionId} cannot be adjudicated until both reviewer scores are present.`, request.id);
          }
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
        const review = await client.query<{ session_id: string; reviewer_user_id: string; second_reviewer_user_id: string | null }>(
          "SELECT session_id, reviewer_user_id, second_reviewer_user_id FROM reviews WHERE id = $1",
          [reviewId],
        );
        const row = review.rows[0];
        if (!row || (row.reviewer_user_id !== auth.userId && row.second_reviewer_user_id !== auth.userId)) {
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
        // AI Collaboration Profile (CPF-30, ADR-0004): the 7-dimension employer-facing
        // narrative lens assembled from Evidence Ledger claims. Never includes evidence
        // references, reviewer confidence, or rationale — those stay reviewer-internal.
        const ledgerClaims = await client.query<{
          dimension: string;
          claim: string;
          evidence_band: string;
          counter_evidence: string | null;
          limitations: string | null;
        }>(
          "SELECT dimension, claim, evidence_band, counter_evidence, limitations FROM evidence_ledger_claims WHERE review_id = $1 ORDER BY created_at ASC",
          [reviewRow.id],
        );
        const claimsByDimension = new Map<string, typeof ledgerClaims.rows>();
        for (const row of ledgerClaims.rows) {
          const bucket = claimsByDimension.get(row.dimension) ?? [];
          bucket.push(row);
          claimsByDimension.set(row.dimension, bucket);
        }
        const bandRank = (band: string) => {
          const i = EVIDENCE_BANDS.indexOf(band as EvidenceBand);
          return i === -1 ? EVIDENCE_BANDS.length : i;
        };
        const collaborationProfile = COLLABORATION_DIMENSIONS.map((dimension) => {
          const claims = claimsByDimension.get(dimension) ?? [];
          const band = claims.length === 0
            ? "Not assessed"
            : claims.reduce((best, c) => (bandRank(c.evidence_band) < bandRank(best) ? c.evidence_band : best), claims[0]!.evidence_band);
          return {
            dimension,
            band,
            claims: claims.map((c) => ({
              claim: c.claim,
              band: c.evidence_band,
              limitations: c.limitations,
              counterEvidence: c.counter_evidence,
            })),
          };
        });
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
          collaborationProfile,
          criticalConcerns: profile.criticalConcerns,
          decisionSupportRoute: profile.decisionSupportRoute,
          interviewProbes: probes,
          governanceNote: profile.governanceNote,
        };
      });
    },
  );
}
