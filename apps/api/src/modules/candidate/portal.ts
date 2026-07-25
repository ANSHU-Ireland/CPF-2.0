import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { hashToken } from "@cpf/identity";
import {
  AssessmentTemplateSchema,
  InvalidTransitionError,
  invitationMachine,
  sessionMachine,
  type SessionEvent,
  type SessionState,
} from "@cpf/assessment-framework";
import { appendAudit } from "../../db/audit.js";
import { getPool, withOrgTx, type Queryable } from "../../db/pool.js";
import { sendError } from "../auth/guards.js";
import { runIdempotent, IdempotencyConflictError } from "../idempotency.js";
import {
  CANDIDATE_SUBMITTABLE_CATEGORIES,
  DSR_DUE_DAYS,
  FORBIDDEN_EVENT_TYPES,
  MAX_EVENT_PAYLOAD_BYTES,
  NOTICE_VERSIONS,
} from "../constants.js";

interface PortalContext {
  organisationId: string;
  invitationId: string;
}

/** Resolve the candidate token through the non-PII routing table. */
async function resolvePortalContext(token: string): Promise<PortalContext | null> {
  const result = await getPool().query<{
    invitation_id: string;
    organisation_id: string;
  }>(
    "SELECT invitation_id, organisation_id FROM invitation_lookup WHERE token_hash = $1 AND expires_at > now()",
    [hashToken(token)],
  );
  const row = result.rows[0];
  return row
    ? { organisationId: row.organisation_id, invitationId: row.invitation_id }
    : null;
}

async function transitionSession(
  client: Queryable,
  sessionId: string,
  event: SessionEvent,
  extraSet = "",
): Promise<SessionState> {
  const current = await client.query<{ status: SessionState }>(
    "SELECT status FROM assessment_sessions WHERE id = $1 FOR UPDATE",
    [sessionId],
  );
  if (!current.rows[0]) throw new Error("Session not found");
  const next = sessionMachine.next(current.rows[0].status, event); // throws InvalidTransitionError on bad flows
  await client.query(
    `UPDATE assessment_sessions SET status = $1, updated_at = now() ${extraSet} WHERE id = $2`,
    [next, sessionId],
  );
  return next;
}

const EventSchema = z.object({
  category: z.string().min(1).max(50),
  eventType: z.string().min(1).max(100),
  payload: z.record(z.string(), z.unknown()).default({}),
});

const DataRightsSchema = z.object({
  requestType: z.enum([
    "access",
    "rectification",
    "erasure",
    "restriction",
    "objection",
    "portability",
    "challenge",
    "human_review",
  ]),
  detail: z.string().max(5_000).optional(),
});

const AccommodationSchema = z.object({ note: z.string().min(1).max(5_000) });

type PortalRequest = FastifyRequest<{ Params: { token: string } }>;

export function registerCandidatePortalRoutes(app: FastifyInstance): void {
  /** Wrapper: resolve context or 404 (indistinguishable for invalid/expired tokens). */
  async function withPortal(
    request: PortalRequest,
    reply: FastifyReply,
    fn: (ctx: PortalContext) => Promise<unknown>,
  ): Promise<unknown> {
    const ctx = await resolvePortalContext(request.params.token);
    if (!ctx) {
      return sendError(reply, 404, "INVITATION_NOT_FOUND", "This invitation link is invalid or has expired.", request.id);
    }
    try {
      return await fn(ctx);
    } catch (error) {
      if (error instanceof InvalidTransitionError) {
        return sendError(reply, 409, "STATE_CONFLICT", error.message, request.id);
      }
      throw error;
    }
  }

  /** Landing view: invitation, template summary, notices, and current state. */
  app.get<{ Params: { token: string } }>("/v1/candidate/:token", async (request, reply) =>
    withPortal(request, reply, (ctx) =>
      withOrgTx(ctx.organisationId, async (client) => {
        const invitation = await client.query<{
          id: string;
          status: string;
          expires_at: Date;
          full_name: string;
          definition: unknown;
        }>(
          `SELECT i.id, i.status, i.expires_at, c.full_name, v.definition
             FROM invitations i
             JOIN candidates c ON c.id = i.candidate_id
             JOIN assessment_template_versions v ON v.id = i.template_version_id
            WHERE i.id = $1`,
          [ctx.invitationId],
        );
        const row = invitation.rows[0]!;
        if (row.status === "sent") {
          await client.query("UPDATE invitations SET status = $1 WHERE id = $2", [
            invitationMachine.next("sent", "open"),
            row.id,
          ]);
        }
        const template = AssessmentTemplateSchema.parse(row.definition);
        const session = await client.query<{ id: string; status: string }>(
          "SELECT id, status FROM assessment_sessions WHERE invitation_id = $1",
          [row.id],
        );
        return {
          candidateName: row.full_name,
          invitationStatus: row.status === "sent" ? "opened" : row.status,
          expiresAt: row.expires_at,
          assessment: {
            code: template.code,
            title: template.title,
            subtitle: template.subtitle,
            timebox: template.timebox,
            purpose: template.purpose,
            approvedTools: template.approvedTools,
            constraints: template.constraints,
            stages: template.stages,
          },
          notices: NOTICE_VERSIONS,
          session: session.rows[0] ?? null,
        };
      }),
    ),
  );

  /** Accept the invitation: creates the session, gated behind disclosure. */
  app.post<{ Params: { token: string } }>("/v1/candidate/:token/accept", async (request, reply) =>
    withPortal(request, reply, async (ctx) => {
      const created = await withOrgTx(ctx.organisationId, async (client) => {
        const invitation = await client.query<{
          id: string;
          status: string;
          template_version_id: string;
          candidate_id: string;
        }>(
          "SELECT id, status, template_version_id, candidate_id FROM invitations WHERE id = $1 FOR UPDATE",
          [ctx.invitationId],
        );
        const row = invitation.rows[0]!;
        const accepted = invitationMachine.next(row.status as never, "accept"); // 409 via machine if not allowed
        await client.query(
          "UPDATE invitations SET status = $1, accepted_at = now() WHERE id = $2",
          [accepted, row.id],
        );
        await client.query(
          "UPDATE candidates SET status = 'active', updated_at = now() WHERE id = $1",
          [row.candidate_id],
        );
        // Machine path: created → present_disclosure → disclosure_pending.
        const initial = sessionMachine.next(sessionMachine.initial, "present_disclosure");
        const session = await client.query<{ id: string }>(
          `INSERT INTO assessment_sessions (organisation_id, invitation_id, template_version_id, status)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [ctx.organisationId, row.id, row.template_version_id, initial],
        );
        await appendAudit(client, {
          organisationId: ctx.organisationId,
          action: "candidate.invitation_accepted",
          entityType: "assessment_session",
          entityId: session.rows[0]!.id,
        });
        return { sessionId: session.rows[0]!.id, status: initial };
      });
      // Reply is dispatched only after COMMIT so follow-up portal calls see the session.
      return reply.status(201).send({
        sessionId: created.sessionId,
        status: created.status,
        disclosure: {
          notices: NOTICE_VERSIONS,
          acknowledgeAt: `/v1/candidate/${request.params.token}/disclosure/acknowledge`,
          note: "The assessment cannot start until you acknowledge the disclosure notices.",
        },
      });
    }),
  );

  /** GUARDRAIL BR-01: the only route to a startable session. */
  app.post<{ Params: { token: string } }>(
    "/v1/candidate/:token/disclosure/acknowledge",
    async (request, reply) =>
      withPortal(request, reply, (ctx) =>
        withOrgTx(ctx.organisationId, async (client) => {
          const session = await client.query<{ id: string }>(
            "SELECT id FROM assessment_sessions WHERE invitation_id = $1",
            [ctx.invitationId],
          );
          if (!session.rows[0]) {
            return sendError(reply, 409, "STATE_CONFLICT", "Accept the invitation first.", request.id);
          }
          const sessionId = session.rows[0].id;
          const next = await transitionSession(client, sessionId, "acknowledge_disclosure");
          await client.query(
            `INSERT INTO disclosure_records
               (organisation_id, session_id, privacy_notice_version, ai_use_notice_version,
                telemetry_notice_version, assessment_rules_version, lawful_basis, acknowledged_at, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8)`,
            [
              ctx.organisationId,
              sessionId,
              NOTICE_VERSIONS.privacyNotice,
              NOTICE_VERSIONS.aiUseNotice,
              NOTICE_VERSIONS.telemetryNotice,
              NOTICE_VERSIONS.assessmentRules,
              "controller_determined", // recorded per controller configuration; see compliance docs
              request.headers["user-agent"] ?? null,
            ],
          );
          await appendAudit(client, {
            organisationId: ctx.organisationId,
            action: "candidate.disclosure_acknowledged",
            entityType: "assessment_session",
            entityId: sessionId,
            metadata: { notices: NOTICE_VERSIONS },
          });
          return { status: next };
        }),
      ),
  );

  for (const [path, event, extra] of [
    ["start", "start", ", started_at = now()"],
    ["pause", "pause", ""],
    ["resume", "resume", ""],
    ["submit", "submit", ", submitted_at = now()"],
    ["withdraw", "withdraw", ""],
  ] as const) {
    app.post<{ Params: { token: string } }>(`/v1/candidate/:token/${path}`, async (request, reply) =>
      withPortal(request, reply, (ctx) =>
        withOrgTx(ctx.organisationId, async (client) => {
          const session = await client.query<{ id: string }>(
            "SELECT id FROM assessment_sessions WHERE invitation_id = $1",
            [ctx.invitationId],
          );
          if (!session.rows[0]) {
            return sendError(reply, 409, "STATE_CONFLICT", "No session exists for this invitation.", request.id);
          }
          const next = await transitionSession(client, session.rows[0].id, event, extra);
          await appendAudit(client, {
            organisationId: ctx.organisationId,
            action: `candidate.session_${event}`,
            entityType: "assessment_session",
            entityId: session.rows[0].id,
          });
          return { status: next };
        }),
      ),
    );
  }

  /** Evidence ingestion with category allow-list and forbidden-event rejection (BR-06). */
  app.post<{ Params: { token: string } }>("/v1/candidate/:token/events", async (request, reply) =>
    withPortal(request, reply, async (ctx) => {
      const parsed = EventSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Invalid event payload.", request.id);
      }
      const { category, eventType, payload } = parsed.data;
      if (!CANDIDATE_SUBMITTABLE_CATEGORIES.has(category)) {
        return sendError(reply, 422, "EVENT_CATEGORY_REJECTED", `Category "${category}" cannot be submitted by a candidate client.`, request.id);
      }
      if (FORBIDDEN_EVENT_TYPES.has(eventType)) {
        return sendError(reply, 422, "EVENT_TYPE_FORBIDDEN", `Event type "${eventType}" is never accepted (monitoring policy).`, request.id);
      }
      if (Buffer.byteLength(JSON.stringify(payload), "utf8") > MAX_EVENT_PAYLOAD_BYTES) {
        return sendError(reply, 413, "EVENT_TOO_LARGE", "Event payload exceeds the size limit.", request.id);
      }
      const outcome = await withOrgTx(ctx.organisationId, async (client) => {
        const session = await client.query<{ id: string; status: string }>(
          "SELECT id, status FROM assessment_sessions WHERE invitation_id = $1",
          [ctx.invitationId],
        );
        const row = session.rows[0];
        if (!row || row.status !== "in_progress") {
          return { accepted: false as const };
        }
        await client.query(
          `INSERT INTO evidence_events (organisation_id, session_id, category, event_type, payload)
           VALUES ($1, $2, $3::evidence_event_category, $4, $5)`,
          [ctx.organisationId, row.id, category, eventType, JSON.stringify(payload)],
        );
        return { accepted: true as const };
      });
      if (!outcome.accepted) {
        // Telemetry outside an active session is rejected by design.
        return sendError(reply, 409, "SESSION_NOT_ACTIVE", "Events are only accepted while the assessment is in progress.", request.id);
      }
      return reply.status(201).send({ accepted: true });
    }),
  );

  /** Accommodation request, recorded before any timing comparison (BR-09). */
  app.post<{ Params: { token: string } }>(
    "/v1/candidate/:token/accommodations",
    async (request, reply) =>
      withPortal(request, reply, async (ctx) => {
        const parsed = AccommodationSchema.safeParse(request.body);
        if (!parsed.success) {
          return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "A note describing the accommodation is required.", request.id);
        }
        return withOrgTx(ctx.organisationId, async (client) => {
          const session = await client.query<{ id: string }>(
            "SELECT id FROM assessment_sessions WHERE invitation_id = $1",
            [ctx.invitationId],
          );
          if (!session.rows[0]) {
            return sendError(reply, 409, "STATE_CONFLICT", "Accept the invitation first.", request.id);
          }
          await client.query(
            "UPDATE assessment_sessions SET accommodations_note = $1, updated_at = now() WHERE id = $2",
            [parsed.data.note, session.rows[0].id],
          );
          await appendAudit(client, {
            organisationId: ctx.organisationId,
            action: "candidate.accommodation_recorded",
            entityType: "assessment_session",
            entityId: session.rows[0].id,
          });
          return { recorded: true };
        });
      }),
  );

  /** Data-rights requests raised directly by the candidate. */
  app.post<{ Params: { token: string } }>(
    "/v1/candidate/:token/data-rights",
    async (request, reply) =>
      withPortal(request, reply, async (ctx) => {
        const parsed = DataRightsSchema.safeParse(request.body);
        if (!parsed.success) {
          return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Invalid data-rights request.", request.id);
        }
        const idempotencyKey = request.headers["idempotency-key"];
        let outcome: { requestId: string; dueAt: Date };
        try {
          outcome = await withOrgTx(ctx.organisationId, async (client) => {
            const doWork = async (): Promise<{ status: number; body: { requestId: string; dueAt: Date } }> => {
              const candidate = await client.query<{ candidate_id: string }>(
                "SELECT candidate_id FROM invitations WHERE id = $1",
                [ctx.invitationId],
              );
              const result = await client.query<{ id: string; due_at: Date }>(
                `INSERT INTO data_rights_requests (organisation_id, candidate_id, request_type, due_at, resolution_note)
                 VALUES ($1, $2, $3, now() + ($4 || ' days')::interval, $5)
                 RETURNING id, due_at`,
                [
                  ctx.organisationId,
                  candidate.rows[0]!.candidate_id,
                  parsed.data.requestType,
                  String(DSR_DUE_DAYS),
                  parsed.data.detail ?? null,
                ],
              );
              await appendAudit(client, {
                organisationId: ctx.organisationId,
                action: "data_rights.request_received",
                entityType: "data_rights_request",
                entityId: result.rows[0]!.id,
                metadata: { requestType: parsed.data.requestType },
              });
              return { status: 201, body: { requestId: result.rows[0]!.id, dueAt: result.rows[0]!.due_at } };
            };

            if (typeof idempotencyKey === "string" && idempotencyKey.length > 0) {
              const idem = await runIdempotent(
                client,
                {
                  scope: "candidate:data-rights-create",
                  actorKey: ctx.invitationId,
                  idempotencyKey,
                  requestBody: parsed.data,
                },
                doWork,
              );
              return idem.body;
            }
            return (await doWork()).body;
          });
        } catch (error) {
          if (error instanceof IdempotencyConflictError) {
            return sendError(reply, 422, "IDEMPOTENCY_KEY_CONFLICT", error.message, request.id);
          }
          throw error;
        }
        return reply.status(201).send({
          requestId: outcome.requestId,
          dueAt: outcome.dueAt,
          status: "received",
        });
      }),
  );
}
