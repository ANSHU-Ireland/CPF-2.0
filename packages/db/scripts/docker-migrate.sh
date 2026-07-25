#!/bin/sh
# Applies every append-only migration file, then ensures the cpf_api LOGIN
# role exists (migration 0004 deliberately creates only the NOLOGIN cpf_app
# group role — each environment provisions its own LOGIN member with its own
# password, never committed to git).
#
# Used by docker-compose's "production" profile `migrate` job — a
# self-contained reference/on-prem deployment path. Staging/production
# against an external managed Postgres uses the same DATABASE_ADMIN_URL
# contract (see docs/operations/operations-and-runbooks.md). This script is
# safe only against a FRESH database; Step 32 adds a schema_migrations
# tracking table + scripts/migrate.mjs so re-runs against an
# already-migrated database become a safe no-op.
set -e

for f in /migrations/*.sql; do
  echo "Applying $f"
  psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f "$f"
done

psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -v pw="$CPF_API_PASSWORD" <<'SQL'
DO $do$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cpf_api') THEN
    EXECUTE format('CREATE ROLE cpf_api LOGIN PASSWORD %L IN ROLE cpf_app', :'pw');
  END IF;
END
$do$;
SQL

echo "Migrations applied and cpf_api role ensured."
