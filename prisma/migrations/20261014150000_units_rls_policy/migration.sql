-- ============================================================
-- RLS policy for Units — default org-scoped shape on the
-- "organizationId" column (identical to Team/Calendar/Role;
-- rls_complete_policies §1). Fail-closed: an empty GUC context
-- matches no row.
--
-- Manual application (owner role) is the same 3 statements as
-- this file; run in order, then verify with
--   SELECT policyname, cmd FROM pg_policies WHERE tablename = 'Units';
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "Units" TO nipp_app;

ALTER TABLE "Units" ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_units_isolated ON "Units"
  USING ("organizationId"::text = current_setting('app.current_org_id', true)
         OR NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1)
  WITH CHECK ("organizationId"::text = current_setting('app.current_org_id', true));
