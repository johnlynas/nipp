-- ============================================================
-- RLS Policies: Super Admin bypass for Organization and AuditLog
-- ============================================================
-- Allows Super Admins (members of the Platform organization) to
-- bypass the app.current_org_id tenant isolation check on
-- Organization and AuditLog tables.
-- Uses current_setting() instead of auth.uid() for BetterAuth compatibility
-- ============================================================

-- Enable RLS on Organization table
ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;

-- Allow Super Admins to bypass org_id check on Organization
CREATE POLICY super_admin_bypass_organization ON "Organization"
  FOR ALL
  USING (
    "id"::text = current_setting('app.current_org_id', true)
    OR EXISTS (
      SELECT 1 FROM "Member" m
      WHERE m."userId" = current_setting('app.current_user_id', true)
        AND m."orgId" = current_setting('app.platform_org_id', true)
    )
  );

-- Enable RLS on AuditLog table
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;

-- Allow Super Admins to bypass org_id check on AuditLog (global read)
CREATE POLICY super_admin_bypass_audit_log_select ON "AuditLog"
  FOR SELECT
  USING (
    "organizationId" IS NULL
    OR "organizationId"::text = current_setting('app.current_org_id', true)
    OR EXISTS (
      SELECT 1 FROM "Member" m
      WHERE m."userId" = current_setting('app.current_user_id', true)
        AND m."orgId" = current_setting('app.platform_org_id', true)
    )
  );

-- Allow Super Admins to insert audit logs (global write)
CREATE POLICY super_admin_insert_audit_log ON "AuditLog"
  FOR INSERT
  WITH CHECK (
    "organizationId" IS NULL
    OR "organizationId"::text = current_setting('app.current_org_id', true)
    OR EXISTS (
      SELECT 1 FROM "Member" m
      WHERE m."userId" = current_setting('app.current_user_id', true)
        AND m."orgId" = current_setting('app.platform_org_id', true)
    )
  );

-- Enable RLS on Member table
ALTER TABLE "Member" ENABLE ROW LEVEL SECURITY;

-- Allow users to see members in their organization
CREATE POLICY member_org_isolation ON "Member"
  FOR ALL
  USING (
    "orgId"::text = current_setting('app.current_org_id', true)
    OR EXISTS (
      SELECT 1 FROM "Member" m
      WHERE m."userId" = current_setting('app.current_user_id', true)
        AND m."orgId" = current_setting('app.platform_org_id', true)
    )
  );

-- Enable RLS on Role table
ALTER TABLE "Role" ENABLE ROW LEVEL SECURITY;

-- Allow users to see roles in their organization
CREATE POLICY role_org_isolation ON "Role"
  FOR ALL
  USING (
    "organizationId"::text = current_setting('app.current_org_id', true)
    OR "organizationId" IS NULL
    OR EXISTS (
      SELECT 1 FROM "Member" m
      WHERE m."userId" = current_setting('app.current_user_id', true)
        AND m."orgId" = current_setting('app.platform_org_id', true)
    )
  );

-- Enable RLS on Permission table (read-only for all authenticated users)
ALTER TABLE "Permission" ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read permissions
CREATE POLICY permission_read_all ON "Permission"
  FOR SELECT
  USING (true);