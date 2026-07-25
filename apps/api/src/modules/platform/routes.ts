import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { generateToken, hashPassword, hashToken, PasswordPolicyError } from "@cpf/identity";
import { appendAudit } from "../../db/audit.js";
import { withOrgTx, withTx } from "../../db/pool.js";
import { requireAuth, requireOrgRole, sendError } from "../auth/guards.js";
import { ACTIVATION_TTL_HOURS } from "../constants.js";

const CreateOrganisationSchema = z.object({
  name: z.string().min(2).max(200),
  slug: z
    .string()
    .min(2)
    .max(63)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u),
  countryCode: z.string().length(2).optional(),
  firstAdmin: z.object({
    email: z.string().email().max(320),
    displayName: z.string().min(1).max(200),
  }),
});

const CreateOrgUserSchema = z.object({
  email: z.string().email().max(320),
  displayName: z.string().min(1).max(200),
  role: z.enum(["org_admin", "hiring_manager", "reviewer", "learning_admin"]),
});

const ActivateSchema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(1).max(256),
});

async function requirePlatformAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await requireAuth(request, reply);
  if (reply.sent) return;
  const isPlatformAdmin = request.auth?.memberships.some((m) => m.role === "platform_admin");
  if (!isPlatformAdmin) {
    await sendError(reply, 403, "FORBIDDEN", "Platform administrator role required.", request.id);
  }
}

interface InvitedUser {
  userId: string;
  activationToken: string;
}

/** Create-or-reuse a user by e-mail, grant a role, and issue an activation token. */
async function inviteUser(
  client: import("../../db/pool.js").Queryable,
  organisationId: string,
  email: string,
  displayName: string,
  role: string,
): Promise<InvitedUser> {
  const user = await client.query<{ id: string }>(
    `INSERT INTO users (email, display_name, status)
     VALUES ($1, $2, 'invited')
     ON CONFLICT (email) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [email, displayName],
  );
  const userId = user.rows[0]!.id;
  await client.query(
    `INSERT INTO org_memberships (organisation_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (organisation_id, user_id, role) DO NOTHING`,
    [organisationId, userId, role],
  );
  const activationToken = generateToken();
  await client.query(
    `INSERT INTO account_activation_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + ($3 || ' hours')::interval)`,
    [userId, hashToken(activationToken), String(ACTIVATION_TTL_HOURS)],
  );
  return { userId, activationToken };
}

export function registerPlatformRoutes(app: FastifyInstance): void {
  /**
   * Create an employer organisation with its first org administrator.
   * The activation token is returned exactly once for out-of-band delivery.
   */
  app.post(
    "/v1/platform/organisations",
    { preHandler: requirePlatformAdmin },
    async (request, reply) => {
      const parsed = CreateOrganisationSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Invalid organisation payload.", request.id);
      }
      const { name, slug, countryCode, firstAdmin } = parsed.data;
      const auth = request.auth!;
      try {
        const result = await withTx(async (client) => {
          const org = await client.query<{ id: string }>(
            `INSERT INTO organisations (slug, name, type, country_code)
             VALUES ($1, $2, 'employer', $3) RETURNING id`,
            [slug, name, countryCode ?? null],
          );
          const organisationId = org.rows[0]!.id;
          await client.query("SELECT set_config('app.current_org_id', $1, true)", [organisationId]);
          await client.query(
            "INSERT INTO retention_policies (organisation_id) VALUES ($1)",
            [organisationId],
          );
          const admin = await inviteUser(client, organisationId, firstAdmin.email, firstAdmin.displayName, "org_admin");
          await appendAudit(client, {
            organisationId,
            actorUserId: auth.userId,
            action: "platform.organisation_created",
            entityType: "organisation",
            entityId: organisationId,
            metadata: { slug, firstAdminUserId: admin.userId },
          });
          return { organisationId, admin };
        });
        return reply.status(201).send({
          organisationId: result.organisationId,
          firstAdmin: {
            userId: result.admin.userId,
            activationToken: result.admin.activationToken,
            note: "Deliver this activation token out of band. It is shown only once.",
          },
        });
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          return sendError(reply, 409, "STATE_CONFLICT", "An organisation with this slug already exists.", request.id);
        }
        throw error;
      }
    },
  );

  app.get("/v1/platform/organisations", { preHandler: requirePlatformAdmin }, async () => {
    return withTx(async (client) => {
      const rows = await client.query(
        `SELECT id, slug, name, type, status, country_code, created_at
           FROM organisations ORDER BY created_at DESC LIMIT 200`,
      );
      return rows.rows;
    });
  });

  /** Org administrators manage their own organisation's users. */
  app.post(
    "/v1/orgs/:orgId/users",
    { preHandler: requireOrgRole("org_admin") },
    async (request, reply) => {
      const parsed = CreateOrgUserSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Invalid user payload.", request.id);
      }
      const orgId = request.orgId!;
      const auth = request.auth!;
      const { email, displayName, role } = parsed.data;
      const result = await withOrgTx(orgId, async (client) => {
        const invited = await inviteUser(client, orgId, email, displayName, role);
        await appendAudit(client, {
          organisationId: orgId,
          actorUserId: auth.userId,
          action: "org.user_invited",
          entityType: "user",
          entityId: invited.userId,
          metadata: { role },
        });
        return invited;
      });
      return reply.status(201).send({
        userId: result.userId,
        activationToken: result.activationToken,
        note: "Deliver this activation token out of band. It is shown only once.",
      });
    },
  );

  /** Complete account activation: single-use token, self-chosen password. */
  app.post("/v1/auth/activate", async (request, reply) => {
    const parsed = ActivateSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Invalid activation payload.", request.id);
    }
    let passwordHash: string;
    try {
      passwordHash = await hashPassword(parsed.data.password);
    } catch (error) {
      if (error instanceof PasswordPolicyError) {
        return sendError(reply, 422, "PASSWORD_POLICY", error.message, request.id);
      }
      throw error;
    }
    const activated = await withTx(async (client) => {
      const tokenRow = await client.query<{ id: string; user_id: string }>(
        `SELECT id, user_id FROM account_activation_tokens
          WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
          FOR UPDATE`,
        [hashToken(parsed.data.token)],
      );
      const row = tokenRow.rows[0];
      if (!row) return null;
      await client.query("UPDATE account_activation_tokens SET used_at = now() WHERE id = $1", [row.id]);
      await client.query(
        `UPDATE users SET password_hash = $1, status = 'active', updated_at = now() WHERE id = $2`,
        [passwordHash, row.user_id],
      );
      await appendAudit(client, {
        actorUserId: row.user_id,
        action: "auth.account_activated",
        entityType: "user",
        entityId: row.user_id,
      });
      return row.user_id;
    });
    if (!activated) {
      return sendError(reply, 422, "ACTIVATION_INVALID", "The activation token is invalid, used, or expired.", request.id);
    }
    return reply.send({ activated: true });
  });
}
