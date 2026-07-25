import type { FastifyReply, FastifyRequest } from "fastify";
import { hashToken } from "@cpf/identity";
import { withTx, withUserTx } from "../../db/pool.js";

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
    }>(
      `SELECT s.id AS session_id, u.id AS user_id, u.display_name, u.email, u.status
         FROM auth_sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1
          AND s.revoked_at IS NULL
          AND s.expires_at > now()`,
      [tokenHash],
    );
    if (result.rows[0]) {
      await client.query("UPDATE auth_sessions SET last_seen_at = now() WHERE id = $1", [
        result.rows[0].session_id,
      ]);
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
  };
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
