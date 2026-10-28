-- ============================================================
-- RLS policies for Work Order Flow tables — default org-scoped
-- shape on the "organizationId" column (identical to
-- rls_units_isolated). Fail-closed: an empty GUC context
-- matches no row.
--
-- Manual application (owner role) is the same statements as
-- this file; run in order, then verify with
--   SELECT policyname, cmd FROM pg_policies
--   WHERE tablename IN ('WorkOrder','WorkOrderNote','Quotation','Invoice');
-- ============================================================

-- WorkOrder: default org-scoped shape on organizationId (identical to rls_units_isolated)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "WorkOrder" TO nipp_app;

ALTER TABLE "WorkOrder" ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_work_orders_isolated ON "WorkOrder"
  USING ("organizationId"::text = current_setting('app.current_org_id', true)
         OR NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1)
  WITH CHECK ("organizationId"::text = current_setting('app.current_org_id', true));

-- WorkOrderNote: default org-scoped shape on organizationId (identical to rls_units_isolated)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "WorkOrderNote" TO nipp_app;

ALTER TABLE "WorkOrderNote" ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_work_order_notes_isolated ON "WorkOrderNote"
  USING ("organizationId"::text = current_setting('app.current_org_id', true)
         OR NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1)
  WITH CHECK ("organizationId"::text = current_setting('app.current_org_id', true));

-- Quotation: default org-scoped shape on organizationId (identical to rls_units_isolated)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "Quotation" TO nipp_app;

ALTER TABLE "Quotation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_quotations_isolated ON "Quotation"
  USING ("organizationId"::text = current_setting('app.current_org_id', true)
         OR NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1)
  WITH CHECK ("organizationId"::text = current_setting('app.current_org_id', true));

-- Invoice: default org-scoped shape on organizationId (identical to rls_units_isolated)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "Invoice" TO nipp_app;

ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_invoices_isolated ON "Invoice"
  USING ("organizationId"::text = current_setting('app.current_org_id', true)
         OR NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1)
  WITH CHECK ("organizationId"::text = current_setting('app.current_org_id', true));
