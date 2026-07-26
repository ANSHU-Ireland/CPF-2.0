import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { generateToken, hashToken } from "@cpf/identity";
import { invitationMachine, TEMPLATE_CODES } from "@cpf/assessment-framework";
import { appendAudit } from "../../db/audit.js";
import { withOrgTx } from "../../db/pool.js";
import { requireModuleEntitlement, requireOrgRole, sendError } from "../auth/guards.js";
import { getOrgPlan } from "../platform/entitlements.js";
import { INVITATION_TTL_DAYS, CANDIDATE_IMPORT_MAX_BYTES, CANDIDATE_IMPORT_MAX_ROWS } from "../constants.js";
import { invitationIssuedTemplate } from "../notifications/templates.js";
import { enqueueOutboundMessage } from "../notifications/queue.js";
import { parseCsvLine, splitCsvLines, neutraliseCsvFormula } from "./csv.js";
import { runIdempotent, IdempotencyConflictError } from "../idempotency.js";

const CreateJobProfileSchema = z.object({
  title: z.string().min(2).max(200),
  roleFamily: z.enum(["software-engineering", "digital-marketing"]),
  description: z.string().max(10_000).default(""),
});

const CreateCandidateSchema = z.object({
  email: z.string().email().max(320),
  fullName: z.string().min(1).max(200),
});

const ListQuerySchema = z.object({
  search: z.string().max(200).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const CreateInvitationSchema = z.object({
  candidateId: z.string().uuid(),
  jobProfileId: z.string().uuid(),
  templateCode: z.enum(TEMPLATE_CODES),
});

const hiringRoles = [requireOrgRole("org_admin", "hiring_manager"), requireModuleEntitlement("assessments")];

export function registerHiringRoutes(app: FastifyInstance): void {
  // ---------------------------------------------------------------- jobs ----
  app.post("/v1/orgs/:orgId/job-profiles", { preHandler: hiringRoles }, async (request, reply) => {
    const parsed = CreateJobProfileSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Invalid job profile.", request.id);
    }
    const orgId = request.orgId!;
    const auth = request.auth!;
    const row = await withOrgTx(orgId, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO job_profiles (organisation_id, title, role_family, description)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [orgId, parsed.data.title, parsed.data.roleFamily, parsed.data.description],
      );
      await appendAudit(client, {
        organisationId: orgId,
        actorUserId: auth.userId,
        action: "hiring.job_profile_created",
        entityType: "job_profile",
        entityId: result.rows[0]!.id,
      });
      return result.rows[0]!;
    });
    return reply.status(201).send({ id: row.id });
  });

  app.get("/v1/orgs/:orgId/job-profiles", { preHandler: hiringRoles }, async (request) => {
    const orgId = request.orgId!;
    return withOrgTx(orgId, async (client) => {
      const rows = await client.query(
        `SELECT id, title, role_family, status, created_at
           FROM job_profiles ORDER BY created_at DESC LIMIT 200`,
      );
      return rows.rows;
    });
  });

  // ---------------------------------------------------------- candidates ----
  app.post("/v1/orgs/:orgId/candidates", { preHandler: hiringRoles }, async (request, reply) => {
    const parsed = CreateCandidateSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Invalid candidate.", request.id);
    }
    const orgId = request.orgId!;
    const auth = request.auth!;
    try {
      const row = await withOrgTx(orgId, async (client) => {
        const result = await client.query<{ id: string }>(
          `INSERT INTO candidates (organisation_id, email, full_name)
           VALUES ($1, $2, $3) RETURNING id`,
          [orgId, parsed.data.email, parsed.data.fullName],
        );
        await appendAudit(client, {
          organisationId: orgId,
          actorUserId: auth.userId,
          action: "hiring.candidate_created",
          entityType: "candidate",
          entityId: result.rows[0]!.id,
        });
        return result.rows[0]!;
      });
      return reply.status(201).send({ id: row.id });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        // BR-07: one live candidate record per (organisation, e-mail).
        return sendError(reply, 409, "DUPLICATE_CANDIDATE", "A candidate with this e-mail already exists in this organisation.", request.id);
      }
      throw error;
    }
  });

  app.post("/v1/orgs/:orgId/candidates/import", { preHandler: hiringRoles, bodyLimit: CANDIDATE_IMPORT_MAX_BYTES }, async (request, reply) => {
    const contentType = request.headers["content-type"] ?? "";
    if (!contentType.includes("csv") && !contentType.includes("text/plain")) {
      return sendError(reply, 415, "UNSUPPORTED_MEDIA_TYPE", "Import body must be text/csv.", request.id);
    }
    const raw = typeof request.body === "string" ? request.body : "";
    const lines = splitCsvLines(raw);
    if (lines.length === 0) {
      return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "The CSV file is empty.", request.id);
    }
    const header = parseCsvLine(lines[0]!).map((h) => h.toLowerCase());
    if (header.length < 2 || header[0] !== "name" || header[1] !== "email") {
      return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", 'The CSV header must be exactly "name,email".', request.id);
    }
    const dataLines = lines.slice(1);
    if (dataLines.length > CANDIDATE_IMPORT_MAX_ROWS) {
      return sendError(
        reply,
        413,
        "IMPORT_TOO_LARGE",
        `The import contains ${dataLines.length} rows, exceeding the limit of ${CANDIDATE_IMPORT_MAX_ROWS}.`,
        request.id,
      );
    }

    const orgId = request.orgId!;
    const auth = request.auth!;
    const emailSchema = z.string().email().max(320);
    const nameSchema = z.string().min(1).max(200);

    interface ValidRow {
      line: number;
      email: string;
      fullName: string;
    }
    const invalid: Array<{ line: number; reason: string }> = [];
    const skippedDuplicates: Array<{ line: number; email: string }> = [];
    const valid: ValidRow[] = [];
    const seenEmails = new Map<string, number>(); // lowercased email -> first line number

    dataLines.forEach((line, index) => {
      const lineNumber = index + 2; // account for the header row, 1-indexed
      const fields = parseCsvLine(line);
      const [name, email] = fields;
      if (!name || !email) {
        invalid.push({ line: lineNumber, reason: "Both name and email are required." });
        return;
      }
      const nameResult = nameSchema.safeParse(name);
      if (!nameResult.success) {
        invalid.push({ line: lineNumber, reason: "Name is invalid or too long." });
        return;
      }
      const emailResult = emailSchema.safeParse(email);
      if (!emailResult.success) {
        invalid.push({ line: lineNumber, reason: "E-mail address is invalid." });
        return;
      }
      const key = emailResult.data.toLowerCase();
      if (seenEmails.has(key)) {
        skippedDuplicates.push({ line: lineNumber, email: emailResult.data });
        return;
      }
      seenEmails.set(key, lineNumber);
      valid.push({ line: lineNumber, email: emailResult.data, fullName: neutraliseCsvFormula(nameResult.data) });
    });

    const idempotencyKey = request.headers["idempotency-key"];
    let outcome: { status: number; body: unknown };
    try {
      outcome = await withOrgTx(orgId, async (client) => {
        const doWork = async (): Promise<{ status: number; body: unknown }> => {
          let createdCount = 0;
          for (const row of valid) {
            const existing = await client.query("SELECT 1 FROM candidates WHERE organisation_id = $1 AND email = $2", [
              orgId,
              row.email,
            ]);
            if ((existing.rowCount ?? 0) > 0) {
              skippedDuplicates.push({ line: row.line, email: row.email });
              continue;
            }
            await client.query(
              `INSERT INTO candidates (organisation_id, email, full_name) VALUES ($1, $2, $3)`,
              [orgId, row.email, row.fullName],
            );
            createdCount += 1;
          }
          await appendAudit(client, {
            organisationId: orgId,
            actorUserId: auth.userId,
            action: "hiring.candidates_imported",
            entityType: "candidate",
            metadata: { created: createdCount, skippedDuplicates: skippedDuplicates.length, invalid: invalid.length },
          });
          return { status: 201, body: { created: createdCount, skippedDuplicates, invalid } };
        };

        if (typeof idempotencyKey === "string" && idempotencyKey.length > 0) {
          const idem = await runIdempotent(
            client,
            { scope: "org:candidate-import", actorKey: orgId, idempotencyKey, requestBody: raw },
            doWork,
          );
          return { status: idem.status, body: idem.body };
        }
        return doWork();
      });
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        return sendError(reply, 422, "IDEMPOTENCY_KEY_CONFLICT", error.message, request.id);
      }
      throw error;
    }

    return reply.status(outcome.status).send(outcome.body);
  });

  app.get("/v1/orgs/:orgId/candidates", { preHandler: hiringRoles }, async (request, reply) => {
    const parsed = ListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Invalid list query.", request.id);
    }
    const { search, cursor, limit } = parsed.data;
    const orgId = request.orgId!;
    return withOrgTx(orgId, async (client) => {
      // Defence in depth: explicit tenant predicate in addition to the RLS backstop.
      const conditions: string[] = ["organisation_id = current_org_id()"];
      const params: unknown[] = [];
      if (search) {
        params.push(`%${search}%`);
        conditions.push(`(email ILIKE $${params.length} OR full_name ILIKE $${params.length})`);
      }
      if (cursor) {
        params.push(cursor);
        conditions.push(`id > $${params.length}`);
      }
      params.push(limit + 1);
      const where = `WHERE ${conditions.join(" AND ")}`;
      const rows = await client.query<{ id: string }>(
        `SELECT id, email, full_name, status, created_at
           FROM candidates ${where}
          ORDER BY id ASC LIMIT $${params.length}`,
        params,
      );
      const page = rows.rows.slice(0, limit);
      return {
        items: page,
        nextCursor: rows.rows.length > limit ? page[page.length - 1]?.id : null,
      };
    });
  });

  app.get("/v1/orgs/:orgId/candidates/:candidateId", { preHandler: hiringRoles }, async (request, reply) => {
    const { candidateId } = request.params as { candidateId: string };
    const orgId = request.orgId!;
    const candidate = await withOrgTx(orgId, async (client) => {
      const rows = await client.query(
        `SELECT c.id, c.email, c.full_name, c.status, c.created_at,
                coalesce(json_agg(json_build_object(
                  'invitationId', i.id, 'status', i.status, 'expiresAt', i.expires_at
                )) FILTER (WHERE i.id IS NOT NULL), '[]') AS invitations
           FROM candidates c
           LEFT JOIN invitations i ON i.candidate_id = c.id
          WHERE c.id = $1
          GROUP BY c.id`,
        [candidateId],
      );
      return rows.rows[0];
    });
    if (!candidate) {
      return sendError(reply, 404, "NOT_FOUND", "Candidate not found.", request.id);
    }
    return candidate;
  });

  // ---------------------------------------------------------- invitations ----
  app.post("/v1/orgs/:orgId/invitations", { preHandler: hiringRoles }, async (request, reply) => {
    const parsed = CreateInvitationSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Invalid invitation.", request.id);
    }
    const orgId = request.orgId!;
    const auth = request.auth!;
    const { candidateId, jobProfileId, templateCode } = parsed.data;
    const idempotencyKey = request.headers["idempotency-key"];

    let outcome: { status: number; body: unknown };
    try {
      outcome = await withOrgTx(orgId, async (client) => {
        const doWork = async (): Promise<{ status: number; body: unknown }> => {
          const version = await client.query<{ id: string }>(
            `SELECT v.id FROM assessment_template_versions v
               JOIN assessment_templates t ON t.id = v.template_id
              WHERE t.code = $1 AND t.status = 'published'
              ORDER BY v.created_at DESC LIMIT 1`,
            [templateCode],
          );
          if (!version.rows[0]) {
            return { status: 404, body: { error: "TEMPLATE_NOT_FOUND" as const } };
          }
          const found = await client.query<{ candidate_full_name?: string; job_title?: string }>(
            `SELECT c.full_name AS candidate_full_name, NULL::text AS job_title FROM candidates c WHERE c.id = $1
             UNION ALL
             SELECT NULL::text, j.title FROM job_profiles j WHERE j.id = $2`,
            [candidateId, jobProfileId],
          );
          if (found.rowCount !== 2) {
            return { status: 404, body: { error: "NOT_FOUND" as const } };
          }

          // Plan limit enforcement (Step 36): orgs with an active subscription
          // that sets a maxActiveAssessments limit are blocked from creating
          // further invitations once the in-flight count (not yet
          // expired/revoked) reaches it. Orgs with no subscription (or a plan
          // that doesn't specify this limit) are unrestricted.
          const plan = await getOrgPlan(client, orgId);
          const maxActiveAssessments = plan?.limits.maxActiveAssessments;
          if (typeof maxActiveAssessments === "number") {
            const active = await client.query<{ count: number }>(
              `SELECT count(*)::int AS count FROM invitations
                WHERE organisation_id = $1 AND status NOT IN ('expired', 'revoked')`,
              [orgId],
            );
            if ((active.rows[0]?.count ?? 0) >= maxActiveAssessments) {
              return { status: 422, body: { error: "PLAN_LIMIT_REACHED" as const } };
            }
          }

          const candidateFullName = found.rows.find((r) => r.candidate_full_name)?.candidate_full_name ?? "Candidate";
          const jobTitle = found.rows.find((r) => r.job_title)?.job_title ?? "Role";
          const orgRow = await client.query<{ name: string }>("SELECT name FROM organisations WHERE id = $1", [orgId]);

          const token = generateToken();
          // Domain machine: draft --send--> sent (issued immediately on creation).
          const status = invitationMachine.next(invitationMachine.initial, "send");
          const invitation = await client.query<{ id: string; expires_at: Date }>(
            `INSERT INTO invitations
               (organisation_id, candidate_id, job_profile_id, template_version_id, status, token_hash, expires_at, sent_at)
             VALUES ($1, $2, $3, $4, $5, $6, now() + ($7 || ' days')::interval, now())
             RETURNING id, expires_at`,
            [orgId, candidateId, jobProfileId, version.rows[0].id, status, hashToken(token), String(INVITATION_TTL_DAYS)],
          );
          const invitationId = invitation.rows[0]!.id;
          await client.query(
            `INSERT INTO invitation_lookup (token_hash, invitation_id, organisation_id, expires_at)
             VALUES ($1, $2, $3, $4)`,
            [hashToken(token), invitationId, orgId, invitation.rows[0]!.expires_at],
          );
          await client.query("UPDATE candidates SET status = 'invited', updated_at = now() WHERE id = $1 AND status = 'created'", [candidateId]);
          const notice = invitationIssuedTemplate({
            candidateName: candidateFullName,
            jobTitle,
            orgName: orgRow.rows[0]?.name ?? "Organisation",
          });
          await enqueueOutboundMessage(client, {
            organisationId: orgId,
            messageType: "invitation_issued",
            toAddress: auth.email,
            subject: notice.subject,
            body: notice.body,
          });
          await appendAudit(client, {
            organisationId: orgId,
            actorUserId: auth.userId,
            action: "hiring.invitation_sent",
            entityType: "invitation",
            entityId: invitationId,
            metadata: { templateCode },
          });
          return {
            status: 201,
            body: {
              invitationId,
              candidateAccessToken: token,
              expiresAt: invitation.rows[0]!.expires_at,
              note: "Deliver the access token to the candidate out of band. It is shown only once.",
            },
          };
        };

        if (typeof idempotencyKey === "string" && idempotencyKey.length > 0) {
          const idem = await runIdempotent(
            client,
            { scope: "org:invitation-create", actorKey: orgId, idempotencyKey, requestBody: parsed.data },
            doWork,
          );
          return { status: idem.status, body: idem.body };
        }
        return doWork();
      });
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        return sendError(reply, 422, "IDEMPOTENCY_KEY_CONFLICT", error.message, request.id);
      }
      throw error;
    }

    const body = outcome.body as { error?: string };
    if (body.error === "PLAN_LIMIT_REACHED") {
      return sendError(
        reply,
        outcome.status,
        body.error,
        "Your organisation has reached its active assessment limit for the current plan. Contact your platform administrator to request a higher limit.",
        request.id,
      );
    }
    if (body.error) {
      return sendError(reply, outcome.status, body.error, "Candidate, job profile, or published template not found.", request.id);
    }
    return reply.status(outcome.status).send(outcome.body);
  });


  /** Reissue an expired or lost invitation with a fresh single-use token (BR-08). */
  app.post(
    "/v1/orgs/:orgId/invitations/:invitationId/reissue",
    { preHandler: hiringRoles },
    async (request, reply) => {
      const { invitationId } = request.params as { invitationId: string };
      const orgId = request.orgId!;
      const auth = request.auth!;
      const result = await withOrgTx(orgId, async (client) => {
        const existing = await client.query<{
          id: string;
          status: string;
          candidate_id: string;
          job_profile_id: string;
          template_version_id: string;
        }>(
          "SELECT id, status, candidate_id, job_profile_id, template_version_id FROM invitations WHERE id = $1 FOR UPDATE",
          [invitationId],
        );
        const row = existing.rows[0];
        if (!row) return { error: "NOT_FOUND" as const };
        // Mark expired if past due, then apply the machine's reissue rule.
        await client.query(
          "UPDATE invitations SET status = 'expired' WHERE id = $1 AND status IN ('sent','opened') AND expires_at <= now()",
          [row.id],
        );
        const current = (
          await client.query<{ status: string }>("SELECT status FROM invitations WHERE id = $1", [row.id])
        ).rows[0]!.status;
        if (!invitationMachine.can(current as never, "reissue")) {
          return { error: "STATE_CONFLICT" as const, current };
        }
        const token = generateToken();
        const fresh = await client.query<{ id: string; expires_at: Date }>(
          `INSERT INTO invitations
             (organisation_id, candidate_id, job_profile_id, template_version_id, status, token_hash, expires_at, sent_at, reissued_from_id)
           VALUES ($1, $2, $3, $4, 'sent', $5, now() + ($6 || ' days')::interval, now(), $7)
           RETURNING id, expires_at`,
          [orgId, row.candidate_id, row.job_profile_id, row.template_version_id, hashToken(token), String(INVITATION_TTL_DAYS), row.id],
        );
        await client.query(
          `INSERT INTO invitation_lookup (token_hash, invitation_id, organisation_id, expires_at)
           VALUES ($1, $2, $3, $4)`,
          [hashToken(token), fresh.rows[0]!.id, orgId, fresh.rows[0]!.expires_at],
        );
        // Invalidate the old routing entry.
        await client.query("DELETE FROM invitation_lookup WHERE invitation_id = $1", [row.id]);
        await appendAudit(client, {
          organisationId: orgId,
          actorUserId: auth.userId,
          action: "hiring.invitation_reissued",
          entityType: "invitation",
          entityId: fresh.rows[0]!.id,
          metadata: { reissuedFrom: row.id },
        });
        return { invitationId: fresh.rows[0]!.id, token, expiresAt: fresh.rows[0]!.expires_at };
      });
      if ("error" in result) {
        if (result.error === "NOT_FOUND") {
          return sendError(reply, 404, "NOT_FOUND", "Invitation not found.", request.id);
        }
        return sendError(reply, 409, "STATE_CONFLICT", `Invitation in state "${result.current}" cannot be reissued.`, request.id);
      }
      return reply.status(201).send({
        invitationId: result.invitationId,
        candidateAccessToken: result.token,
        expiresAt: result.expiresAt,
      });
    },
  );
}
