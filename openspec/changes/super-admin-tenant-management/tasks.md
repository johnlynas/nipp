# Tasks

## 0. Pre-Implementation Verification
- [ ] 0.1 Verify all existing component filenames use PascalCase (RequireSuperAdmin.tsx, RequirePermission.tsx)
- [ ] 0.2 Verify middleware.ts does NOT import `@/lib/db` or `@/lib/global-db` directly
- [ ] 0.3 Verify all API routes have `export const runtime = 'nodejs'` where Prisma is used
- [ ] 0.4 Verify Property NI colors are defined in `tailwind.config.ts`
- [ ] 0.5 Verify existing `/api/admin/organizations/route.ts` still works (non-regression)

## 1. Updated Prisma Seed Script
- [ ] 1.1 Update `prisma/seed.ts` to detect whether running against `nipp_dev` or `nipp_test` (via env var or connection string)
- [ ] 1.2 Create `OrgA` ("Acme Properties Ltd") with status ACTIVE and slug "acme-properties-ltd"
- [ ] 1.3 Create `OrgB` ("Belfast Rentals") with status ACTIVE and slug "belfast-rentals"
- [ ] 1.4 Create tenant user `orga-tenant@example.com` with password from `TEST_TENANT_A_PASSWORD` env var (or `TENANT_A_PASSWORD` for dev)
- [ ] 1.5 Create tenant user `orgb-tenant@example.com` with password from `TEST_TENANT_B_PASSWORD` env var (or `TENANT_B_PASSWORD` for dev)
- [ ] 1.6 Add OrgA tenant user as a member of OrgA with role "member"
- [ ] 1.7 Add OrgB tenant user as a member of OrgB with role "member"
- [ ] 1.8 Ensure default roles (member, property-manager, viewer) exist in both OrgA and OrgB with appropriate permissions
- [ ] 1.9 **TEST:** Write unit test to verify seed creates exactly OrgA, OrgB, and both tenant users
- [ ] 1.10 Update `.env.example` with new env vars: `TEST_TENANT_A_EMAIL`, `TEST_TENANT_A_PASSWORD`, `TEST_TENANT_B_EMAIL`, `TEST_TENANT_B_PASSWORD`

## 2. Super Admin Tenant Management API — Members
- [ ] 2.1 Create `app/api/admin/organizations/[orgId]/members/route.ts` (GET list, POST create)
- [ ] 2.2 **VERIFY:** Route file includes `export const runtime = 'nodejs'`
- [ ] 2.3 **VERIFY:** Route imports `requireSuperAdmin()` from `lib/require-super-admin`
- [ ] 2.4 **VERIFY:** Route uses `globalDb` for org existence check, `tenantDb` within `runWithTenant()` for member operations
- [ ] 2.5 Create `app/api/admin/organizations/[orgId]/members/[memberId]/route.ts` (PATCH update, DELETE remove)
- [ ] 2.6 **TEST:** Write unit tests for GET members (mock Prisma, verify auth guard)
- [ ] 2.7 **TEST:** Write unit tests for POST member (verify validation, verify audit log call)
- [ ] 2.8 **TEST:** Write unit tests for PATCH/DELETE member (verify non-Super Admin gets 403)

## 3. Super Admin Tenant Management API — Roles
- [ ] 3.1 Create `app/api/admin/organizations/[orgId]/roles/route.ts` (GET list, POST create)
- [ ] 3.2 Create `app/api/admin/organizations/[orgId]/roles/[roleId]/route.ts` (PATCH update, DELETE delete)
- [ ] 3.3 **VERIFY:** Route uses `globalDb` for org existence check, `tenantDb` within `runWithTenant()` for role operations
- [ ] 3.4 **TEST:** Write unit tests for GET roles (mock Prisma, verify auth guard)
- [ ] 3.5 **TEST:** Write unit tests for POST role (verify validation, verify audit log call)
- [ ] 3.6 **TEST:** Write unit tests for DELETE role (verify safety check — warn if members assigned)

## 4. Super Admin Tenant Management API — Permissions
- [ ] 4.1 Create `app/api/admin/organizations/[orgId]/permissions/route.ts` (GET list, PATCH assign/revoke)
- [ ] 4.2 **VERIFY:** Route uses `globalDb` for org existence check, `tenantDb` within `runWithTenant()` for permission operations
- [ ] 4.3 **TEST:** Write unit tests for GET permissions (mock Prisma, verify auth guard)
- [ ] 4.4 **TEST:** Write unit tests for PATCH permissions (verify role-permission assignment, verify audit log call)

## 5. Super Admin Tenant Management API — Settings
- [ ] 5.1 Create `app/api/admin/organizations/[orgId]/settings/route.ts` (PATCH update name, slug, status)
- [ ] 5.2 Implement state machine validation for status changes (PENDING → ACTIVE ↔ SUSPENDED → ARCHIVED)
- [ ] 5.3 **VERIFY:** Route uses `globalDb` for the update (Organization model is global, not org-scoped)
- [ ] 5.4 **TEST:** Write unit tests for PATCH settings (verify validation, verify state machine)
- [ ] 5.5 **TEST:** Write unit tests for invalid status transitions (expect 400)

## 6. Super Admin Tenant Management UI — Members Page
- [ ] 6.1 Create `app/admin/organizations/[orgId]/members/page.tsx` (list view with add member button)
- [ ] 6.2 **VERIFY:** Page wrapped in `<RequireSuperAdmin>`
- [ ] 6.3 Create `components/admin/TenantMemberForm.tsx` (add/edit member form with email input, role selector)
- [ ] 6.4 **TEST:** Write unit test for TenantMemberForm (render with props, verify submit calls API)
- [ ] 6.5 **VERIFY:** Header uses `bg-[#1B2A4A]` (Navy), Primary button uses `bg-[#F5A623]` (Amber)

## 7. Super Admin Tenant Management UI — Roles Page
- [ ] 7.1 Create `app/admin/organizations/[orgId]/roles/page.tsx` (list view with create role button)
- [ ] 7.2 **VERIFY:** Page wrapped in `<RequireSuperAdmin>`
- [ ] 7.3 Create `components/admin/TenantRoleForm.tsx` (add/edit role form with name, description, permission checkboxes)
- [ ] 7.4 **TEST:** Write unit test for TenantRoleForm (render with props, verify submit calls API)
- [ ] 7.5 **VERIFY:** Default roles shown as protected (cannot be edited/deleted by non-Super Admin — but Super Admin can)

## 8. Super Admin Tenant Management UI — Permissions Page
- [ ] 8.1 Create `app/admin/organizations/[orgId]/permissions/page.tsx` (grid view of roles × permissions with checkboxes)
- [ ] 8.2 **VERIFY:** Page wrapped in `<RequireSuperAdmin>`
- [ ] 8.3 Create `components/admin/TenantPermissionAssign.tsx` (checkbox grid component for assigning permissions to roles)
- [ ] 8.4 **TEST:** Write unit test for TenantPermissionAssign (render with data, verify checkbox state changes)

## 9. Super Admin Tenant Management UI — Settings Page
- [ ] 9.1 Create `app/admin/organizations/[orgId]/settings/page.tsx` (form with name, slug, status dropdown)
- [ ] 9.2 **VERIFY:** Page wrapped in `<RequireSuperAdmin>`
- [ ] 9.3 Add confirmation dialog for status changes to SUSPENDED or ARCHIVED
- [ ] 9.4 **TEST:** Write unit test for settings page (render with props, verify submit calls API)

## 10. Integration & Non-Regression Testing
- [ ] 10.1 **INTEGRATION:** Super Admin logs in → navigates to OrgA members page → adds member → verifies member appears
- [ ] 10.2 **INTEGRATION:** Super Admin logs in → navigates to OrgB roles page → creates role → verifies role appears
- [ ] 10.3 **INTEGRATION:** Super Admin logs in → navigates to OrgA permissions page → assigns permission → verifies assignment
- [ ] 10.4 **INTEGRATION:** Super Admin logs in → navigates to OrgA settings page → changes status to SUSPENDED → verifies state change
- [ ] 10.5 **NON-REGRESSION:** Existing `/admin/organizations` list view still works
- [ ] 10.6 **NON-REGRESSION:** Existing `/api/admin/organizations/route.ts` still works
- [ ] 10.7 **SECURITY:** Non-Super Admin user gets 403 on all new endpoints
- [ ] 10.8 **SECURITY:** Non-Super Admin user sees AccessDenied on all new UI pages
