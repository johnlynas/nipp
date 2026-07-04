-- ============================================================
-- RLS Template Migration — Enable Row Level Security
-- ============================================================
-- This is a TEMPLATE demonstrating how to enable RLS on tables.
-- Actual RLS policies for business tables will be added in future
-- feature proposals when those tables are created.
--
-- To apply RLS to a new table:
--   1. Ensure the table has an "organizationId" column (text or varchar)
--   2. Copy the pattern below, replacing "<table_name>" with your table
--   3. Add this to a new Prisma migration file
-- ============================================================

-- Enable RLS on the database (run once per database)
-- NOTE: This must be run as a superuser or table owner
-- ALTER DATABASE "<database_name>" SET row_security = on;

-- Example: Enable RLS on a hypothetical "properties" table
-- ALTER TABLE "properties" ENABLE ROW LEVEL SECURITY;

-- Example: Create tenant isolation policy for all operations
-- CREATE POLICY tenant_isolation_properties ON "properties"
--   USING ("organizationId"::text = current_setting('app.current_org_id', true));

-- Example: Policy for INSERT (users can only insert into their own org)
-- CREATE POLICY tenant_insert_properties ON "properties"
--   FOR INSERT WITH CHECK ("organizationId"::text = current_setting('app.current_org_id', true));

-- Example: Policy for UPDATE
-- CREATE POLICY tenant_update_properties ON "properties"
--   FOR UPDATE USING ("organizationId"::text = current_setting('app.current_org_id', true));

-- Example: Policy for DELETE
-- CREATE POLICY tenant_delete_properties ON "properties"
--   FOR DELETE USING ("organizationId"::text = current_setting('app.current_org_id', true));

-- ============================================================
-- Session variable setup (done in lib/tenant-db.ts via Prisma extension)
-- ============================================================
-- Before queries, set: SELECT set_config('app.current_org_id', '<orgId>', true);
-- The 'true' flag makes it transaction-scoped.
