-- ============================================================
-- Migration: Fix Permission RLS Policy (S12)
-- ============================================================
-- Replaces the overly permissive 'permission_read_all' policy
-- with an organization-scoped policy that restricts permission
-- reads to platform admins or permissions assigned to the user's org.
--
-- Note: Permission is a GLOBAL model (no organizationId field).
-- Roles are org-scoped and link to permissions via RolePermission.
-- ============================================================

-- Drop the overly permissive read-all policy
DROP POLICY IF EXISTS permission_read_all ON "Permission";

-- Create organization-scoped policy for permissions
CREATE POLICY permission_org_isolation ON "Permission"
  FOR SELECT
  USING (
    -- Platform admins can read all permissions
    EXISTS (
      SELECT 1 FROM "Member" m
      WHERE m."userId" = current_setting('app.current_user_id', true)
        AND m."orgId" = current_setting('app.platform_org_id', true)
    )
    OR
    -- Regular users can read permissions assigned to their org's roles
    EXISTS (
      SELECT 1 FROM "RolePermission" rp
      JOIN "Role" r ON rp."roleId" = r.id
      WHERE rp."permissionId" = "Permission".id
        AND rp."organizationId"::text = current_setting('app.current_org_id', true)
    )
  );
