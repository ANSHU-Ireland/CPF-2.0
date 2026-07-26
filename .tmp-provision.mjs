import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const conn = "postgresql://cpf:cpf_local_dev@127.0.0.1:5432/cpf";
const client = new pg.Client({ connectionString: conn });
await client.connect();
try {
  const exists = await client.query("SELECT to_regclass('public.organisations') AS t");
  if (!exists.rows[0].t) {
    for (const file of readdirSync(join(process.cwd(), "packages", "db", "migrations")).sort()) {
      if (file.endsWith(".sql")) {
        console.log("Applying", file);
        await client.query(readFileSync(join(process.cwd(), "packages", "db", "migrations", file), "utf8"));
      }
    }
  }
  await client.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cpf_api') THEN CREATE ROLE cpf_api LOGIN PASSWORD 'cpf_local_dev' IN ROLE cpf_app; END IF; END $$;");
  const seeded = await client.query("SELECT count(*)::int AS n FROM assessment_template_versions");
  if (seeded.rows[0].n === 0) {
    const seed = readFileSync(join(process.cwd(), "packages", "db", "seed", "generated", "seed.sql"), "utf8");
    await client.query(seed);
  }
  console.log("Provisioned");
} finally {
  await client.end();
}
