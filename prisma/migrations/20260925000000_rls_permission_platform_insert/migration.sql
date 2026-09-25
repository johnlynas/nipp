-- ============================================================
-- RLS follow-up: permission catalog INSERT for platform admins
-- ============================================================
-- The admin dashboard creates permissions (POST /api/dashboard/
-- admin/permissions, verified via requireSuperAdmin at the route
-- boundary). Permission had a SELECT policy only — with no INSERT
-- policy, CREATE denied everyone including platform admins
-- ("new row violates row-level security policy for table
-- Permission", 42501) even though UPDATE/DELETE were granted to
-- platform admins by 20260920000000_rls_platform_write_paths.
--
-- Add FOR INSERT for verified platform admins ONLY — symmetric with
-- the existing update/delete policies. Tenant actors keep no write
-- path; tenant visibility is unchanged (SELECT policy, S12).
DO $$ BEGIN
  IF NOT EXISTS (
     SELECT 1 FROM pg_policies WHERE policyname = 'rls_permission_platform_insert'
  ) THEN
     CREATE POLICY rls_permission_platform_insert ON "Permission"
       FOR INSERT
       WITH CHECK (NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1);
  END IF;
END $$;
