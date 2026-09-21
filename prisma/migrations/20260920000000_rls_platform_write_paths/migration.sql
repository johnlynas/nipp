-- ============================================================
-- RLS follow-up: platform-admin write paths
-- ============================================================
-- Phase 3 cutover (verified live on dev nipp_dev, nipp_app role probes):
-- the admin permission catalog and notification-history routes are
-- SUPER-ADMIN surfaces that previously executed as owner (full bypass).
-- Under RLS they need explicit platform-admin write policies to keep
-- working; without them every mutation silently affects 0 rows.
--
-- Permission: add UPDATE + DELETE for verified platform admins only —
-- the catalog stays read-only for tenant actors (SELECT policy, S12).
-- Notification: add DELETE for verified platform admins only — matches
-- the existing UPDATE (admin acknowledgment) posture; tenant visibility
-- is unchanged.
DO $$ BEGIN
   IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE policyname = 'rls_permission_platform_update'
   ) THEN
      CREATE POLICY rls_permission_platform_update ON "Permission"
        FOR UPDATE
        USING (NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1)
        WITH CHECK (NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1);
   END IF;

   IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE policyname = 'rls_permission_platform_delete'
   ) THEN
      CREATE POLICY rls_permission_platform_delete ON "Permission"
        FOR DELETE
        USING (NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1);
   END IF;

   IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE policyname = 'rls_notification_delete'
   ) THEN
      CREATE POLICY rls_notification_delete ON "Notification"
        FOR DELETE
        USING (NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1);
   END IF;
END $$;
