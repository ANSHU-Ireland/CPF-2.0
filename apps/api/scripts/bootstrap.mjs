/**
 * One-time platform bootstrap: creates the CPF platform organisation and the
 * first platform administrator. Idempotence: fails safely if already present.
 *
 * Usage (never pass secrets as CLI args):
 *   BOOTSTRAP_EMAIL=founder@example.eu BOOTSTRAP_PASSWORD='...' \
 *   DATABASE_URL=postgresql://... node apps/api/scripts/bootstrap.mjs
 *
 * Requires `npm run build` first (imports built packages).
 */
import pg from "pg";
import { hashPassword } from "@cpf/identity";

const { DATABASE_URL, BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD } = process.env;
if (!DATABASE_URL || !BOOTSTRAP_EMAIL || !BOOTSTRAP_PASSWORD) {
  console.error("Required env vars: DATABASE_URL, BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD");
  process.exit(1);
}

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  const existing = await client.query("SELECT 1 FROM organisations WHERE type = 'platform'");
  if (existing.rowCount > 0) {
    console.error("A platform organisation already exists — refusing to bootstrap again.");
    process.exit(2);
  }
  const org = await client.query(
    `INSERT INTO organisations (slug, name, type) VALUES ('cpf-platform', 'CPF Platform', 'platform') RETURNING id`,
  );
  // org_memberships is FORCE RLS-protected: establish tenant context for the write.
  await client.query("SELECT set_config('app.current_org_id', $1, true)", [org.rows[0].id]);
  const passwordHash = await hashPassword(BOOTSTRAP_PASSWORD);
  const user = await client.query(
    `INSERT INTO users (email, display_name, status, password_hash)
     VALUES ($1, 'Platform Administrator', 'active', $2) RETURNING id`,
    [BOOTSTRAP_EMAIL, passwordHash],
  );
  await client.query(
    `INSERT INTO org_memberships (organisation_id, user_id, role) VALUES ($1, $2, 'platform_admin')`,
    [org.rows[0].id, user.rows[0].id],
  );
  await client.query("COMMIT");
  console.log(`Platform bootstrapped. Organisation ${org.rows[0].id}, admin ${user.rows[0].id}.`);
  console.log("Sign in at POST /v1/auth/login, then enrol MFA at /v1/auth/mfa/totp/enroll.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
