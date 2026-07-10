-- ============================================================
-- RLS Policies: Super Admin bypass for Organization and AuditLog
-- ============================================================
-- Allows Super Admins (members of the Platform organization) to
-- bypass the app.current_org_id tenant isolation check on
-- Organization and AuditLog tables.
-- ============================================================

-- Enable RLS on Organization table
ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;

-- Allow Super Admins to bypass org_id check on Organization
CREATE POLICY super_admin_bypass_organization ON "Organization"
  USING (
    "id"::text = current_setting('app.current_org_id', true)
    OR EXISTS (
      SELECT 1 FROM "Member" m
      WHERE m."userId" = auth.uid()::text
        AND m."orgId" = current_setting('app.platform_org_id', true)
    )
  );

-- Allow Super Admins to bypass org_id check on AuditLog (global read)
CREATE POLICY super_admin_bypass_audit_log ON "AuditLog"
  USING (
    "organizationId" IS NULL
    OR "organizationId"::text = current_setting('app.current_org_id', true)
    OR EXISTS (
      SELECT 1 FROM "Member" m
      WHERE m."userId" = auth.uid()::text
        AND m."orgId" = current_setting('app.platform_org_id', true)
    )
  );

-- Allow Super Admins to insert audit logs (global write)
CREATE POLICY super_admin_insert_audit_log ON "AuditLog"
  FOR INSERT WITH CHECK (
    "organizationId" IS NULL
    OR "organizationId"::text = current_setting('app.current_org_id', true)
    OR EXISTS (
      SELECT 1 FROM "Member" m
      WHERE m."userId" = auth.uid()::text
        AND m."orgId" = current_setting('app.platform_org_id', true)
    )
  );
