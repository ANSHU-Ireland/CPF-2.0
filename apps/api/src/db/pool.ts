import pg from "pg";

const { Pool } = pg;

export type Queryable = pg.PoolClient;

let pool: pg.Pool | undefined;

export function createPool(databaseUrl: string): pg.Pool {
  pool ??= new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  return pool;
}

export function getPool(): pg.Pool {
  if (!pool) throw new Error("Database pool not initialised");
  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

/** Run work inside a transaction with no tenant context (platform-level data only). */
export async function withTx<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Run work inside a transaction with tenant context established via
 * `app.current_org_id` (transaction-local). Row-level security policies are
 * FORCEd, so every tenant-table read/write inside is isolated to this org.
 */
export async function withOrgTx<T>(
  organisationId: string,
  fn: (client: Queryable) => Promise<T>,
): Promise<T> {
  return withTx(async (client) => {
    await client.query("SELECT set_config('app.current_org_id', $1, true)", [
      organisationId,
    ]);
    return fn(client);
  });
}

/** Transaction with self-scoped user context (authentication flows: read own memberships). */
export async function withUserTx<T>(
  userId: string,
  fn: (client: Queryable) => Promise<T>,
): Promise<T> {
  return withTx(async (client) => {
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
    return fn(client);
  });
}
