-- ============================================================
-- RLS Foundation: create the non-owner application role
-- ============================================================
-- The application must connect under a role that does NOT own the
-- tables, because table owners bypass RLS entirely (PostgreSQL).
-- All migrations and seed scripts continue to run as the owner
-- role (POSTGRES_USER, default "postgres"); only runtime app
-- traffic switches to nipp_app in Phase 2 of the RLS plan.
--
-- Password is injected at apply time by scripts/apply-roles-migration.ts
-- from NIPP_APP_DB_PASSWORD (never stored in the migration file).
-- ============================================================

DO $$ BEGIN
   IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nipp_app') THEN
      CREATE ROLE nipp_app LOGIN NOSUPERUSER NOCREATEDB NOREPLICATION;
   END IF;
END $$;

GRANT USAGE ON SCHEMA public TO nipp_app;

DO $$
DECLARE r RECORD;
BEGIN
   FOR r IN
      SELECT c.oid, n.nspname AS schema_name, c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
   LOOP
      EXECUTE format(
         'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I TO nipp_app',
         r.schema_name, r.table_name
      );
   END LOOP;
END $$;

-- Cover tables created later by new migrations (owner creates them).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nipp_app;
