-- ============================================================
-- RLS Complete Policy Catalog (18 tables)
-- ============================================================
-- Authoritative RLS policy set for nipp. Supersedes:
--   * 20260711000000_rls_policies      (never applied to any instance)
--   * 20260715000000_permission_rls_fix (never applied to any instance)
-- Those two files were edited in place to no-op comments; this migration
-- is the single source of truth for all row-level security.
--
-- Trust model (documents/rls-complete-implementation.md §3):
--   * App traffic connects as nipp_app — a NON-owner role, so RLS applies
--     without FORCE ROW LEVEL SECURITY. Owner (postgres/nipp_svc) is used
--     only for migrations and seed; it legitimately bypasses RLS.
--   * Context GUCs are set transaction-locally (set_config local=true) by
--     lib/rls-context.ts at the start of a Prisma interactive transaction,
--     on the same connection as the guarded query:
--       app.current_user_id      verified BetterAuth user id
--       app.current_org_id       target org for this request
--       app.is_platform_admin    '1' if caller is a verified platform-org member
--       app.platform_org_id      platform org id (job tables only)
--   * Fail-closed: with no GUCs set, current_setting(…, true) returns NULL,
--     and NULL in a predicate matches no row — every policy below denies an
--     empty context.
--
-- Exempt tables (no policy, by design — documented in SECURITY.md):
--   User, Session, Account      global BetterAuth auth models
--   Resource, ResourceRole      global feature catalog; sensitive side sits
--                               on org-scoped Role rows (covered below)
-- ============================================================

-- ------------------------------------------------------------
-- 1. Default shape: org-scoped tables (organizationId column)
--    SELECT/UPDATE/DELETE: own org rows OR platform admin (read).
--    INSERT/WITH CHECK: bound to the context org — a platform admin
--    writes *as* the target tenant, never with a wildcard.
-- ------------------------------------------------------------

ALTER TABLE "Team" ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_team_isolated ON "Team"
  USING ("organizationId"::text = current_setting('app.current_org_id', true)
         OR NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1)
  WITH CHECK ("organizationId"::text = current_setting('app.current_org_id', true));

ALTER TABLE "TeamMember" ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_teammember_isolated ON "TeamMember"
  USING ("organizationId"::text = current_setting('app.current_org_id', true)
         OR NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1)
  WITH CHECK ("organizationId"::text = current_setting('app.current_org_id', true));

ALTER TABLE "TeamRole" ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_teamrole_isolated ON "TeamRole"
  USING ("organizationId"::text = current_setting('app.current_org_id', true)
         OR NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1)
  WITH CHECK ("organizationId"::text = current_setting('app.current_org_id', true));

ALTER TABLE "Calendar" ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_calendar_isolated ON "Calendar"
  USING ("organizationId"::text = current_setting('app.current_org_id', true)
         OR NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1)
  WITH CHECK ("organizationId"::text = current_setting('app.current_org_id', true));

ALTER TABLE "CalendarEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_calendarevent_isolated ON "CalendarEvent"
  USING ("organizationId"::text = current_setting('app.current_org_id', true)
         OR NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1)
  WITH CHECK ("organizationId"::text = current_setting('app.current_org_id', true));

ALTER TABLE "Role" ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_role_isolated ON "Role"
  USING ("organizationId"::text = current_setting('app.current_org_id', true)
         OR NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1)
  WITH CHECK ("organizationId"::text = current_setting('app.current_org_id', true));

ALTER TABLE "RolePermission" ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_rolepermission_isolated ON "RolePermission"
  USING ("organizationId"::text = current_setting('app.current_org_id', true)
         OR NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1)
  WITH CHECK ("organizationId"::text = current_setting('app.current_org_id', true));

ALTER TABLE "MemberRole" ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_memberrole_isolated ON "MemberRole"
  USING ("organizationId"::text = current_setting('app.current_org_id', true)
         OR NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1)
  WITH CHECK ("organizationId"::text = current_setting('app.current_org_id', true));

-- ------------------------------------------------------------
-- 2. Org-scoped tables whose org column is named orgId (BetterAuth models)
-- ------------------------------------------------------------

ALTER TABLE "Member" ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_member_isolated ON "Member"
  USING ("orgId"::text = current_setting('app.current_org_id', true)
         OR NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1)
  WITH CHECK ("orgId"::text = current_setting('app.current_org_id', true));

ALTER TABLE "Invitation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_invitation_isolated ON "Invitation"
  USING ("orgId"::text = current_setting('app.current_org_id', true)
         OR NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1)
  WITH CHECK ("orgId"::text = current_setting('app.current_org_id', true));

ALTER TABLE "SentInvitation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_sentinvitation_isolated ON "SentInvitation"
  USING ("orgId"::text = current_setting('app.current_org_id', true)
         OR NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1)
  WITH CHECK ("orgId"::text = current_setting('app.current_org_id', true));

-- ------------------------------------------------------------
-- 3. Organization — per-command policies
--    Rows are only editable by platform ops acting on the org (context =
--    target org); tenant-context UPDATE/DELETE of an org row is denied,
--    which prevents self-privilege edits.
-- ------------------------------------------------------------

ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_organization_select ON "Organization"
  FOR SELECT
  USING (id::text = current_setting('app.current_org_id', true)
         OR NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1);
CREATE POLICY rls_organization_insert ON "Organization"
  FOR INSERT
  WITH CHECK (NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1);
CREATE POLICY rls_organization_update ON "Organization"
  FOR UPDATE
  USING (id::text = current_setting('app.current_org_id', true)
         AND NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1);
CREATE POLICY rls_organization_delete ON "Organization"
  FOR DELETE
  USING (id::text = current_setting('app.current_org_id', true)
         AND NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1);

-- ------------------------------------------------------------
-- 4. AuditLog — append-only, cross-tenant admin visibility
--    SELECT/INSERT: own org OR global (NULL org) rows OR platform admin.
--    No UPDATE/DELETE policies exist on purpose: DELETE of audit rows is
--    denied to everyone (nipp_app), owner only can alter the log.
-- ------------------------------------------------------------

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_auditlog_select ON "AuditLog"
  FOR SELECT
  USING ("organizationId" IS NULL
         OR "organizationId"::text = current_setting('app.current_org_id', true)
         OR NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1);
CREATE POLICY rls_auditlog_insert ON "AuditLog"
  FOR INSERT
  WITH CHECK ("organizationId" IS NULL
              OR "organizationId"::text = current_setting('app.current_org_id', true)
              OR NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1);

-- ------------------------------------------------------------
-- 5. NotificationLog — write-once delivery tracking
--    SELECT/INSERT: org rows, global (NULL), or platform admin.
--    No UPDATE/DELETE policy: append-only for the app role.
-- ------------------------------------------------------------

ALTER TABLE "NotificationLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_notificationlog_select ON "NotificationLog"
  FOR SELECT
  USING ("organizationId" IS NULL
         OR "organizationId"::text = current_setting('app.current_org_id', true)
         OR NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1);
CREATE POLICY rls_notificationlog_insert ON "NotificationLog"
  FOR INSERT
  WITH CHECK ("organizationId" IS NULL
              OR "organizationId"::text = current_setting('app.current_org_id', true)
              OR NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1);

-- ------------------------------------------------------------
-- 6. Notification — SSE scope semantics (schema header, model comment):
--    GLOBAL broadcasts live with organizationId NULL; ORG notifications are
--    tenant + super-admin visible. Writes: own org, or platform (global
--    broadcasts / acks). UPDATE = admin acknowledgment path.
-- ------------------------------------------------------------

ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_notification_select ON "Notification"
  FOR SELECT
  USING (NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1
         OR "organizationId" IS NULL
         OR "organizationId"::text = current_setting('app.current_org_id', true));
CREATE POLICY rls_notification_insert ON "Notification"
  FOR INSERT
  WITH CHECK ("organizationId"::text = current_setting('app.current_org_id', true)
              OR "organizationId" IS NULL
              OR NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1);
CREATE POLICY rls_notification_update ON "Notification"
  FOR UPDATE
  USING (NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1
         OR "organizationId" IS NULL
         OR "organizationId"::text = current_setting('app.current_org_id', true));

-- ------------------------------------------------------------
-- 7. JobDefinition / JobExecution — platform-only, strongest stance.
--    These tables store executable operator code; the only legitimate actor
--    is a verified platform admin (flag) AND the context platform org must
--    match the row's platformOrgId (route sets app.platform_org_id from the
--    env-derived platform org). Tenant-context requests can never touch them.
-- ------------------------------------------------------------

ALTER TABLE "JobDefinition" ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_jobdefinition_platform_only ON "JobDefinition"
  FOR ALL
  USING (NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1
         AND "platformOrgId"::text = current_setting('app.platform_org_id', true))
  WITH CHECK (NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1
              AND "platformOrgId"::text = current_setting('app.platform_org_id', true));

ALTER TABLE "JobExecution" ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_jobexecution_platform_only ON "JobExecution"
  FOR ALL
  USING (NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1
         AND "platformOrgId"::text = current_setting('app.platform_org_id', true))
  WITH CHECK (NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1
              AND "platformOrgId"::text = current_setting('app.platform_org_id', true));

-- ------------------------------------------------------------
-- 8. Permission — global catalog, restricted read (S12 posture).
--    Platform admins see the full catalog; tenant users/roles see only
--    permissions assigned to a role in their org via RolePermission.
--    No write policy: catalog mutations are owner/migration-level only.
-- ------------------------------------------------------------

ALTER TABLE "Permission" ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_permission_select ON "Permission"
  FOR SELECT
  USING (NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1
         OR EXISTS (
            SELECT 1 FROM "RolePermission" rp
            WHERE rp."permissionId" = "Permission".id
              AND rp."organizationId"::text = current_setting('app.current_org_id', true)
         ));
