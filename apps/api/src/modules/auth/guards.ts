import type { FastifyReply, FastifyRequest } from "fastify";
import { hashToken } from "@cpf/identity";
import { withTx, withUserTx } from "../../db/pool.js";
import { SESSION_SLIDING_TTL_HOURS, STEP_UP_FRESHNESS_MINUTES } from "../constants.js";

export type OrgRole =
  | "platform_admin"
  | "org_admin"
  | "hiring_manager"
  | "reviewer"
  | "support_agent"
  | "learning_admin";

export interface AuthContext {
  userId: string;
  sessionId: string;
  displayName: string;
  email: string;
  memberships: Array<{ organisationId: string; role: OrgRole }>;
  /** Timestamp of the session's most recent full re-authentication (login or /v1/auth/step-up). */
  steppedUpAt: Date;
}


declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
    orgId?: string;
  }
}

export function sendError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  requestId: string,
): FastifyReply {
  return reply.status(status).send({
    error: { code, message, requestId, retryable: false },
  });
}

/** Resolve and validate the bearer session; attaches request.auth. */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    await sendError(reply, 401, "UNAUTHENTICATED", "Authentication required.", request.id);
    return;
  }
  const tokenHash = hashToken(header.slice("Bearer ".length).trim());
  const session = await withTx(async (client) => {
    const result = await client.query<{
      session_id: string;
      user_id: string;
      display_name: string;
      email: string;
      status: string;
      stepped_up_at: Date;
    }>(
      `SELECT s.id AS session_id, u.id AS user_id, u.display_name, u.email, u.status, s.stepped_up_at
         FROM auth_sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1
          AND s.revoked_at IS NULL
          AND s.expires_at > now()`,
      [tokenHash],
    );
    if (result.rows[0]) {
      // Sliding renewal (CPF-27): activity extends expiry, but never past the
      // session's fixed absolute_expires_at cap set at login time.
      await client.query(
        `UPDATE auth_sessions
            SET last_seen_at = now(),
                expires_at = LEAST(now() + ($2 || ' hours')::interval, absolute_expires_at)
          WHERE id = $1`,
        [result.rows[0].session_id, String(SESSION_SLIDING_TTL_HOURS)],
      );
    }
    return result.rows[0];
  });
  if (!session || session.status !== "active") {
    await sendError(reply, 401, "UNAUTHENTICATED", "Session is invalid or expired.", request.id);
    return;
  }
  const memberships = await withUserTx(session.user_id, async (client) => {
    const result = await client.query<{ organisation_id: string; role: OrgRole }>(
      "SELECT organisation_id, role FROM org_memberships WHERE user_id = $1",
      [session.user_id],
    );
    return result.rows.map((r) => ({ organisationId: r.organisation_id, role: r.role }));
  });
  request.auth = {
    userId: session.user_id,
    sessionId: session.session_id,
    displayName: session.display_name,
    email: session.email,
    memberships,
    steppedUpAt: session.stepped_up_at,
  };
}

/**
 * Requires the current session to have completed a full re-authentication
 * (login, or POST /v1/auth/step-up) within the last STEP_UP_FRESHNESS_MINUTES.
 * Must run AFTER requireAuth/requireOrgRole in the preHandler chain. Guards
 * sensitive actions (e.g. org data export) against a stolen/idle bearer token.
 */
export async function requireFreshAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const auth = request.auth;
  if (!auth) {
    await sendError(reply, 401, "UNAUTHENTICATED", "Authentication required.", request.id);
    return;
  }
  const freshnessMs = STEP_UP_FRESHNESS_MINUTES * 60_000;
  if (Date.now() - auth.steppedUpAt.getTime() > freshnessMs) {
    await sendError(
      reply,
      401,
      "STEP_UP_REQUIRED",
      "This action requires you to re-confirm your identity. Please re-authenticate and try again.",
      request.id,
    );
  }
}

/**
 * Server-side, deny-by-default role check for org-scoped routes
 * (path parameter `orgId`). Attaches request.orgId on success.
 */
export function requireOrgRole(...roles: OrgRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await requireAuth(request, reply);
    if (reply.sent) return;
    const { orgId } = request.params as { orgId?: string };
    if (!orgId) {
      await sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Missing organisation id.", request.id);
      return;
    }
    const membership = request.auth?.memberships.find(
      (m) => m.organisationId === orgId && roles.includes(m.role),
    );
    if (!membership) {
      await sendError(
        reply,
        403,
        "FORBIDDEN",
        "You do not have the required role in this organisation.",
        request.id,
      );
      return;
    }
    request.orgId = orgId;
  };
}
