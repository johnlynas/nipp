
```markdown
# Tasks

## 0. Pre-Implementation Verification
- [x] 0.1 Verify all existing component filenames use PascalCase (RequirePermission.tsx)
- [x] 0.2 Verify middleware.ts does NOT import `@/lib/db` or `@/lib/redis` directly
- [x] 0.3 Verify all API routes have `export const runtime = 'nodejs'` where Prisma is used
- [x] 0.4 Verify Property NI colors are defined in `tailwind.config.ts`

## 1. Database Schema & Seed
- [x] 1.1 Add `OrgStatus` enum to `prisma/schema.prisma` (PENDING, ACTIVE, SUSPENDED, ARCHIVED).
- [x] 1.2 Add `status` (OrgStatus, default PENDING) and `slug` (String, unique) fields to the `Organization` model.
- [x] 1.3 Add `metadata` (Json, optional) field to the `Organization` model.
- [x] 1.4 Create `AuditLog` model with fields: id, timestamp, userId, userName, action, resourceType, resourceId, organizationId, ipAddress, userAgent, success, metadata.
- [x] 1.5 Create `NotificationLog` model with fields: id, timestamp, recipientEmail, eventType, message, status (SENT, FAILED), organizationId.
- [x] 1.6 Create `MemberRole` junction table (fix pre-existing bug).
- [x] 1.7 Add new platform permissions to seed script: `platform:manage_organizations`, `platform:manage_roles`, `platform:manage_permissions`, `platform:view_audit_logs`.
- [ ] 1.8 **TEST:** Write unit test to verify seed script creates exactly the 4 new platform permissions.
- [ ] 1.9 **CRITICAL:** Create a Prisma migration script that sets `status = 'ACTIVE'` and generates unique `slug` values for all existing organizations.
- [x] 1.10 Run `npx prisma migrate dev` to apply schema changes.
- [x] 1.11 Update RLS policies to allow Super Admins to bypass `app.current_org_id` check on the `Organization` and `AuditLog` tables.

## 2. Global Database Client
- [x] 2.1 Create `lib/global-db.ts` exporting an unscoped Prisma client (without tenant isolation extension).
- [x] 2.2 Add JSDoc warning comments making it clear this client bypasses tenant isolation.
- [x] 2.3 Ensure `global-db.ts` is NOT imported by middleware or client components.
- [ ] 2.4 **TEST:** Write unit test to verify `global-db.ts` does NOT have the tenant isolation extension applied.

## 3. Organization Lifecycle API
- [x] 3.1 Create `app/api/admin/organizations/route.ts` (GET list, POST create).
- [x] 3.2 **VERIFY:** Route file includes `export const runtime = 'nodejs'`
- [x] 3.3 **VERIFY:** Route imports `globalDb` from `lib/global-db.ts`
- [x] 3.4 **VERIFY:** Route is wrapped with `requireSuperAdmin()` guard
- [ ] 3.5 **TEST:** Write unit tests for the route handlers (mock Prisma).
- [x] 3.6 Create `app/api/admin/organizations/[id]/route.ts` (GET detail, PATCH update, DELETE archive).
- [x] 3.7 Create `app/api/admin/organizations/[id]/status/route.ts` (PATCH suspend/reactivate).
- [ ] 3.8 **TEST:** Write unit tests for the state machine (verify invalid transitions return 400).
- [x] 3.9 **VERIFY:** `GET /api/admin/organizations` MUST enforce pagination using Prisma's `skip` and `take`. Default page size should be 20.
- [x] 3.10 Implement state machine validation (prevent invalid transitions).
- [x] 3.11 When status changes to SUSPENDED, invalidate all sessions for members of that organization.
- [x] 3.12 Integrate with existing `org-bootstrap.ts` for automatic role creation on org creation.
- [x] 3.13 **TEST:** Write integration test: Create org (PENDING) -> Suspend (SUSPENDED) -> Archive (ARCHIVED).

## 4. Audit Logging Infrastructure
- [x] 4.1 Create `lib/audit-log.ts` with `recordAuditLog()` function.
- [x] 4.2 Create middleware or API wrapper that automatically logs mutations to `/api/admin/*` and `/api/roles/*` routes.
- [x] 4.3 Ensure audit entries include: userId, action, resourceType, resourceId, organizationId, ipAddress, userAgent, success, metadata.
- [ ] 4.4 **TEST:** Write unit test for `recordAuditLog()` to verify it inserts the correct payload into the DB.

## 5. Notification System
- [x] 5.1 Create `lib/notifications/email.ts` with email sending function (nodemailer or similar).
- [x] 5.2 Create `lib/notifications/events.ts` defining extreme event types and thresholds.
- [x] 5.3 Implement rate limiting: max 5 notifications per event type per 24-hour window.
- [x] 5.4 Create `lib/notifications/dispatcher.ts` that checks rate limits, sends email, and logs to `NotificationLog`.
- [ ] 5.5 **TEST:** Write unit test for `dispatcher.ts` to verify rate limiting (mock the email sender, call it 6 times, assert only 5 emails were "sent").
- [ ] 5.6 Integrate notification dispatcher with audit log (trigger notifications on extreme events).
- [x] 5.7 Add SMTP configuration to `.env.example`.
- [x] 5.8 **VERIFY:** Email templates for notifications MUST use the Property NI Navy (#1B2A4A) header and Amber (#F5A623) accents.

## 6. Custom Role & Permission Management API
- [x] 6.1 Update existing `/api/roles` routes to support Super Admin cross-org access.
- [x] 6.2 Create `DELETE /api/roles/[roleId]` with safety check (warns if members assigned) and default role protection.
- [ ] 6.3 **TEST:** Write unit test: Attempt to delete a role with 1 assigned member -> expect warning/400. Attempt to delete role with 0 members -> expect success.
- [x] 6.4 Create `app/api/admin/permissions/route.ts` for global permission catalog CRUD (Super Admin only).
- [ ] 6.5 **TEST:** Write unit test: Standard user calls endpoint -> expect 403. Super Admin calls endpoint -> expect 200.
- [ ] 6.6 Record all role/permission changes in audit log.

## 7. Super Admin Dashboard UI (Strictly Gated)
- [x] 7.1 Create `components/auth/RequireSuperAdmin.tsx` (Wrapper that checks `useIsSuperAdmin()`).
- [x] 7.2 **VERIFY:** Component filename is `RequireSuperAdmin.tsx` (PascalCase)
- [x] 7.3 **TEST:** Write unit test: Render component with non-admin user -> expect `<AccessDenied>`. Render with admin -> expect children.
- [x] 7.4 Create `app/admin/organizations/page.tsx` (list view with search, filter by status, pagination). Wrap in `<RequireSuperAdmin>`.
- [x] 7.5 **VERIFY:** Header uses `bg-[#1B2A4A]` (Navy), Primary button uses `bg-[#F5A623]` (Amber)
- [x] 7.6 Create `app/admin/organizations/[id]/page.tsx` (detail view with tabs: Overview, Members, Roles, Audit). Wrap in `<RequireSuperAdmin>`.
- [x] 7.7 Create `app/admin/organizations/create/page.tsx` (create form: name, slug, initial admin email). Wrap in `<RequireSuperAdmin>`.
- [x] 7.8 Create `app/admin/permissions/page.tsx` (global permission catalog management). Wrap in `<RequireSuperAdmin>`.
- [x] 7.9 Create `app/admin/audit-logs/page.tsx` (audit log viewer with filters). Wrap in `<RequireSuperAdmin>`.
- [x] 7.10 Update main navigation/layout to conditionally render "Admin" links using `useIsSuperAdmin()`.
- [x] 7.11 Update `app/page.tsx` (Root Route):
      - Fetch the current session.
      - IF Super Admin: `redirect('/admin/organizations')`.
      - IF Tenant User: Render the existing default tenant homepage component.
- [x] 7.12 Create shared components:
      - `components/admin/OrgStatusBadge.tsx` (color-coded status badge)
      - `components/admin/OrgTable.tsx` (sortable, filterable organization table)
      - `components/admin/RoleManager.tsx` (reusable role CRUD component)
      - `components/admin/AuditLogViewer.tsx` (filterable audit log table)
      - `components/admin/ConfirmDialog.tsx` (reusable confirmation modal)
      - `components/admin/AccessDenied.tsx` (fallback UI)
- [x] 7.13 **VERIFY:** All icon-only buttons include `aria-label` attributes.
- [x] 7.14 **VERIFY:** All UI MUST use Property NI Navy (`#1B2A4A`) and Amber (`#F5A623`) design tokens.

## 8. Org Admin Role Management UI
- [x] 8.1 Create `app/org/[orgId]/roles/page.tsx` (Org Admin role management, scoped to their org).
- [ ] 8.2 Reuse `RoleManager.tsx` component with Org Admin permission restrictions.
- [ ] 8.3 Default roles displayed as read-only (no edit/delete buttons).
- [ ] 8.4 Custom roles displayed with full CRUD.

## 9. Integration & Non-Regression Tests
- [ ] 9.1 Test: Super Admin can list ALL organizations (bypasses tenant isolation).
- [ ] 9.2 Test: Tenant user CANNOT access `/admin/*` routes (blocked by `<RequireSuperAdmin>` and API `requireSuperAdmin()` middleware).
- [ ] 9.3 Test: Tenant user does NOT see "Admin" navigation links in the UI.
- [ ] 9.4 Test: Super Admin visiting `/` is redirected to `/admin/organizations`.
- [ ] 9.5 Test: Tenant user visiting `/` sees the default homepage.
- [ ] 9.6 Test: Organization creation triggers automatic role bootstrapping.
- [ ] 9.7 Test: Suspending an org invalidates member sessions.
- [ ] 9.8 Test: Role deletion safety check returns warning when role has active members.
- [ ] 9.9 Test: Org Admin CANNOT edit/delete default roles.
- [ ] 9.10 Test: Audit log records all admin actions with correct metadata.
- [ ] 9.11 Test: Notification rate limiting works (max 5 per event per 24h).
- [ ] 9.12 Test: Organization state machine prevents invalid transitions.
- [ ] 9.13 Test: Logout flow still works correctly after all changes (non-regression).
- [ ] 9.14 Test: Cross-tab session invalidation still works (non-regression).
- [ ] 9.15 Test: Redis permission caching still works (non-regression).

## 10. Documentation & Cleanup
- [ ] 10.1 Update `README.md` with new admin routes, features, and platform permissions.
- [ ] 10.2 Update `.env.example` with SMTP configuration variables.
- [x] 10.3 Add inline documentation to `lib/global-db.ts` explaining tenant isolation bypass.
- [ ] 10.4 Run `npm run build` to verify no TypeScript errors.
- [x] 10.5 **VERIFY:** No "Module not found" errors related to casing mismatches.
- [x] 10.6 **VERIFY:** No "Edge Runtime" errors related to Prisma/Redis imports.
- [ ] 10.7 Verify `npm test` (unit) and `npm run test:integration` both pass.