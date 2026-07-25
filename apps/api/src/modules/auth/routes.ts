import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  generateToken,
  generateTotpSecret,
  hashToken,
  totpProvisioningUri,
  verifyPassword,
  verifyTotp,
} from "@cpf/identity";
import { appendAudit } from "../../db/audit.js";
import { withTx } from "../../db/pool.js";
import { requireAuth, sendError } from "./guards.js";
import { SESSION_ABSOLUTE_TTL_HOURS, SESSION_SLIDING_TTL_HOURS } from "../constants.js";

const LOCKOUT_WINDOW_MINUTES = 15;
const LOCKOUT_THRESHOLD = 5;

const LoginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(256),
  totpCode: z.string().regex(/^\d{6}$/u).optional(),
});

const TotpVerifySchema = z.object({ totpCode: z.string().regex(/^\d{6}$/u) });
const StepUpSchema = z.object({
  password: z.string().min(1).max(256),
  totpCode: z.string().regex(/^\d{6}$/u).optional(),
});


export function registerAuthRoutes(app: FastifyInstance): void {
  app.post("/v1/auth/login", async (request, reply) => {
    const parsed = LoginSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "Invalid login request.", request.id);
    }
    const { email, password, totpCode } = parsed.data;

    // The reply is dispatched only AFTER the transaction commits: sending from
    // inside `withTx` would let the client observe responses whose state
    // (attempt rows, session rows) is not yet visible to its next request.
    type LoginOutcome =
      | { kind: "locked" }
      | { kind: "invalid" }
      | { kind: "mfa_required" }
      | {
          kind: "ok";
          token: string;
          expiresAt: Date;
          user: { id: string; displayName: string };
          memberships: Array<{ organisationId: string; role: string }>;
        };

    const outcome = await withTx<LoginOutcome>(async (client) => {
      // Lockout window: 5 failed attempts per 15 minutes per e-mail.
      const attempts = await client.query<{ failures: string }>(
        `SELECT count(*) AS failures FROM login_attempts
          WHERE email = $1 AND succeeded = false
            AND attempted_at > now() - ($2 || ' minutes')::interval`,
        [email, String(LOCKOUT_WINDOW_MINUTES)],
      );
      if (Number(attempts.rows[0]?.failures ?? 0) >= LOCKOUT_THRESHOLD) {
        await client.query(
          "INSERT INTO login_attempts (email, succeeded) VALUES ($1, false)",
          [email],
        );
        return { kind: "locked" };
      }

      const users = await client.query<{
        id: string;
        display_name: string;
        password_hash: string | null;
        status: string;
        mfa_enrolled: boolean;
        totp_secret: string | null;
      }>(
        "SELECT id, display_name, password_hash, status, mfa_enrolled, totp_secret FROM users WHERE email = $1",
        [email],
      );
      const user = users.rows[0];
      const passwordOk =
        user?.password_hash != null &&
        user.status === "active" &&
        (await verifyPassword(password, user.password_hash));
      const mfaOk =
        passwordOk &&
        (!user.mfa_enrolled ||
          (user.totp_secret != null && totpCode != null && verifyTotp(user.totp_secret, totpCode)));

      await client.query("INSERT INTO login_attempts (email, succeeded) VALUES ($1, $2)", [
        email,
        Boolean(passwordOk && mfaOk),
      ]);

      if (!user || !passwordOk) {
        // Identical response for unknown user / wrong password: no enumeration.
        return { kind: "invalid" };
      }
      if (!mfaOk) {
        return { kind: "mfa_required" };
      }

      const token = generateToken();
      const expiresAt = new Date(Date.now() + SESSION_SLIDING_TTL_HOURS * 3_600_000);
      const absoluteExpiresAt = new Date(Date.now() + SESSION_ABSOLUTE_TTL_HOURS * 3_600_000);
      await client.query(
        `INSERT INTO auth_sessions (user_id, token_hash, expires_at, absolute_expires_at, stepped_up_at, user_agent)
         VALUES ($1, $2, $3, $4, now(), $5)`,
        [user.id, hashToken(token), expiresAt, absoluteExpiresAt, request.headers["user-agent"] ?? null],
      );
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [user.id]);
      const memberships = await client.query<{ organisation_id: string; role: string }>(
        "SELECT organisation_id, role FROM org_memberships WHERE user_id = $1",
        [user.id],
      );
      await appendAudit(client, {
        actorUserId: user.id,
        action: "auth.login",
        entityType: "auth_session",
        metadata: { userAgent: request.headers["user-agent"] ?? "unknown" },
      });
      return {
        kind: "ok",
        token,
        expiresAt,
        user: { id: user.id, displayName: user.display_name },
        memberships: memberships.rows.map((m) => ({
          organisationId: m.organisation_id,
          role: m.role,
        })),
      };
    });

    switch (outcome.kind) {
      case "locked":
        return sendError(reply, 423, "ACCOUNT_LOCKED", "Too many failed attempts. Try again later.", request.id);
      case "invalid":
        return sendError(reply, 401, "INVALID_CREDENTIALS", "Invalid e-mail or password.", request.id);
      case "mfa_required":
        return sendError(reply, 401, "MFA_REQUIRED", "A valid 6-digit authenticator code is required.", request.id);
      case "ok":
        return reply.send({
          token: outcome.token,
          expiresAt: outcome.expiresAt.toISOString(),
          user: { ...outcome.user, email },
          memberships: outcome.memberships,
        });
    }
  });

  app.post("/v1/auth/logout", { preHandler: requireAuth }, async (request, reply) => {
    const auth = request.auth!;
    await withTx(async (client) => {
      await client.query("UPDATE auth_sessions SET revoked_at = now() WHERE id = $1", [
        auth.sessionId,
      ]);
      await appendAudit(client, {
        actorUserId: auth.userId,
        action: "auth.logout",
        entityType: "auth_session",
        entityId: auth.sessionId,
      });
    });
    return reply.send({ revoked: true });
  });

  app.post("/v1/auth/sessions/revoke-all", { preHandler: requireAuth }, async (request, reply) => {
    const auth = request.auth!;
    const count = await withTx(async (client) => {
      const result = await client.query(
        "UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
        [auth.userId],
      );
      await appendAudit(client, {
        actorUserId: auth.userId,
        action: "auth.revoke_all_sessions",
        entityType: "auth_session",
        metadata: { revoked: result.rowCount ?? 0 },
      });
      return result.rowCount ?? 0;
    });
    return reply.send({ revoked: count });
  });

  app.get("/v1/auth/me", { preHandler: requireAuth }, async (request) => {
    const auth = request.auth!;
    return {
      user: { id: auth.userId, displayName: auth.displayName, email: auth.email },
      memberships: auth.memberships,
    };
  });

  /**
   * Step-up re-authentication (CPF-27): proves the caller's identity again
   * (password, plus TOTP if MFA-enrolled) without issuing a new session, and
   * marks the CURRENT session as freshly authenticated. Sensitive actions
   * (e.g. org data export) require this freshness within the last
   * STEP_UP_FRESHNESS_MINUTES; otherwise they respond 401 STEP_UP_REQUIRED.
   */
  app.post("/v1/auth/step-up", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = StepUpSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "A password is required.", request.id);
    }
    const auth = request.auth!;
    const verified = await withTx(async (client) => {
      const rows = await client.query<{
        password_hash: string | null;
        mfa_enrolled: boolean;
        totp_secret: string | null;
      }>("SELECT password_hash, mfa_enrolled, totp_secret FROM users WHERE id = $1", [auth.userId]);
      const user = rows.rows[0];
      const passwordOk = user?.password_hash != null && (await verifyPassword(parsed.data.password, user.password_hash));
      const mfaOk =
        passwordOk &&
        (!user.mfa_enrolled ||
          (user.totp_secret != null &&
            parsed.data.totpCode != null &&
            verifyTotp(user.totp_secret, parsed.data.totpCode)));
      if (!passwordOk || !mfaOk) return false;
      await client.query("UPDATE auth_sessions SET stepped_up_at = now() WHERE id = $1", [auth.sessionId]);
      await appendAudit(client, {
        actorUserId: auth.userId,
        action: "auth.step_up_verified",
        entityType: "auth_session",
        entityId: auth.sessionId,
      });
      return true;
    });
    if (!verified) {
      return sendError(reply, 401, "STEP_UP_FAILED", "Re-authentication failed.", request.id);
    }
    return reply.send({ steppedUp: true });
  });

  // --- TOTP enrollment (two-step: provision, then confirm with a live code) ---

  app.post("/v1/auth/mfa/totp/enroll", { preHandler: requireAuth }, async (request, reply) => {
    const auth = request.auth!;
    const secret = generateTotpSecret();
    await withTx(async (client) => {
      await client.query(
        "UPDATE users SET totp_secret = $1, mfa_enrolled = false, updated_at = now() WHERE id = $2",
        [secret, auth.userId],
      );
      await appendAudit(client, {
        actorUserId: auth.userId,
        action: "auth.mfa_enroll_started",
        entityType: "user",
        entityId: auth.userId,
      });
    });
    return reply.send({
      secret,
      provisioningUri: totpProvisioningUri(secret, auth.email),
      note: "Confirm with a live code at /v1/auth/mfa/totp/verify to activate MFA.",
    });
  });

  app.post("/v1/auth/mfa/totp/verify", { preHandler: requireAuth }, async (request, reply) => {
    const auth = request.auth!;
    const parsed = TotpVerifySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "REQUEST_VALIDATION_FAILED", "A 6-digit code is required.", request.id);
    }
    const activated = await withTx(async (client) => {
      const rows = await client.query<{ totp_secret: string | null }>(
        "SELECT totp_secret FROM users WHERE id = $1",
        [auth.userId],
      );
      const secret = rows.rows[0]?.totp_secret;
      if (!secret || !verifyTotp(secret, parsed.data.totpCode)) return false;
      await client.query(
        "UPDATE users SET mfa_enrolled = true, updated_at = now() WHERE id = $1",
        [auth.userId],
      );
      await appendAudit(client, {
        actorUserId: auth.userId,
        action: "auth.mfa_enrolled",
        entityType: "user",
        entityId: auth.userId,
      });
      return true;
    });
    if (!activated) {
      return sendError(reply, 422, "MFA_VERIFICATION_FAILED", "The code did not match.", request.id);
    }
    return reply.send({ mfaEnrolled: true });
  });
}
