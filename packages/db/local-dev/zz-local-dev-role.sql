-- LOCAL DEVELOPMENT ONLY — mounted into the compose PostgreSQL container.
-- Creates the login member of cpf_app that the API connects as.
-- Never use this password outside local development.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cpf_api') THEN
    CREATE ROLE cpf_api LOGIN PASSWORD 'cpf_local_dev' IN ROLE cpf_app;
  END IF;
END $$;
