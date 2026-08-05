# Tasks

## 0. Pre-Implementation Verification
- [ ] 0.1 Verify existing `services/organization-service.ts` is the only service file in `services/`
- [ ] 0.2 Verify `lib/global-db.ts` and `lib/tenant-db.ts` are importable
- [ ] 0.3 Verify existing `/api/admin/organizations/route.ts` still works (non-regression baseline)
- [ ] 0.4 Verify existing `/api/admin/organizations/[orgId]/roles/route.ts` still works (non-regression baseline)
- [ ] 0.5 Verify existing `/api/admin/organizations/[orgId]/permissions/route.ts` still works (non-regression baseline)
- [ ] 0.6 Verify Redis permission cache invalidation utility exists (from `auth-and-rbac` proposal) or note as dependency

## 1. Shared Types, Helpers & Error Mapper
- [ ] 1.1 Create `lib/services/types.ts` with:
  - [ ] 1.1.1 `ServiceContext` interface (userId, role, organizationId)
    - Document: `ctx.organizationId` is set by the route that constructs the context. For Platform Admins, this is typically undefined or the Platform org ID.
    - Document: Multi-org resolution — a user may hold memberships in multiple orgs; `ctx.organizationId` represents the active session context (the org used by the calling route).
  - [ ] 1.1.2 Typed error classes: `ValidationError` (400), `UnauthorizedError` (401), `ForbiddenError` (403), `NotFoundError` (404), `ConflictError` (409)
    - Document: `ValidationError` for validation failures (e.g., missing required fields, invalid pagination params)
    - Document: `UnauthorizedError` for programming errors (e.g., missing ctx.userId)
    - Document: Prisma P2002 unique constraint violations are translated to `ConflictError` by the service layer
  - [ ] 1.1.3 `PaginatedResult<T>` generic interface
  - [ ] 1.1.4 `PaginationInput` with bounds: page default=1 (min=1), pageSize default=20 (max=100)
  - [ ] 1.1.5 Filter types: `OrganizationFilters`, `UserFilters`, `RoleFilters`, `PermissionFilters`
- [ ] 1.2 Create `lib/services/base-service.ts` with authorization helper functions (not a class):
  - [ ] 1.2.1 `requirePlatformAdmin(ctx)` — throws ForbiddenError if ctx.role !== 'PLATFORM_ADMIN'
  - [ ] 1.2.2 `requireTenantAdmin(ctx, targetOrgId)` — throws ForbiddenError if ctx.role !== 'TENANT_ADMIN' OR targetOrgId !== ctx.organizationId
    - Also throws for MEMBER role (all operations denied)
  - [ ] 1.2.3 `requireAnyAdmin(ctx)` — throws ForbiddenError if ctx.role === 'MEMBER'
  - [ ] 1.2.4 `resolveOrgScope(ctx, targetOrgId?)` — returns explicit targetOrgId if provided; falls back to ctx.organizationId. Throws ValidationError if neither is available for an org-scoped operation.
  - [ ] 1.2.5 `logFailedAuth(ctx, action)` — logs failed authorization attempts for security observability
- [ ] 1.3 Create `lib/services/error-handler.ts` with:
  - [ ] 1.3.1 `handleServiceError(error)` — maps error types to HTTP responses (400/401/403/404/409)
  - [ ] 1.3.2 Fallback handler for unexpected errors (500)
- [ ] 1.4 **TEST:** Write unit tests for error classes (verify properties, instanceof checks)
- [ ] 1.5 **TEST:** Write unit tests for authorization helpers (verify correct throws/returns, verify MEMBER denial)
- [ ] 1.6 **TEST:** Write unit tests for `resolveOrgScope` (verify explicit targetOrgId takes precedence, verify fallback to ctx.org, verify ValidationError when neither available)
- [ ] 1.7 **TEST:** Write unit tests for `handleServiceError` (verify correct HTTP status codes per error type)

## 2. OrganizationService Refactor
- [ ] 2.1 Add `getOrganizationById(id)` method (Platform Admin: any org; Tenant Admin: own org only)
- [ ] 2.2 Add `updateOrganization(id, data)` method (Platform Admin: any org; Tenant Admin: own org only)
  - Mutable fields: `name`, `status`. **Slug is immutable after creation** (tenant identifiers shouldn't casually change).
- [ ] 2.3 Add `deleteOrganization(id)` method with safety semantics:
  - Throws `ConflictError` if the organization has any members (query Member count)
  - **Platform Organization is protected:** If org slug matches `PLATFORM_ORG_SLUG` env var, throws `ForbiddenError('Cannot delete the Platform Organization')`
  - Hard delete — cascading deletes handled by Prisma `onDelete: Cascade` relations
- [ ] 2.4 Add authorization checks to all methods using `ServiceContext`
- [ ] 2.5 Preserve existing `createOrganization()` and `getPaginatedOrganizations()` logic
- [ ] 2.6 **TEST:** Write unit tests for `getOrganizationById` (mock Prisma, verify auth guard)
- [ ] 2.7 **TEST:** Write unit tests for `updateOrganization` (verify validation, verify slug immutability)
- [ ] 2.8 **TEST:** Write unit tests for `deleteOrganization` (verify ConflictError if members exist; verify Platform org protection)
- [ ] 2.9 **TEST:** Write unit tests for Tenant Admin restrictions (verify ForbiddenError on cross-org)
- [ ] 2.10 **INTEGRATION:** Test full CRUD flow against test database

## 3. UserService
- [ ] 3.1 Create `services/user-service.ts` with:
  - **Model locality:** Global model, uses `globalDb`. Tenant Admin access enforced via Member join table filtering.
  - [ ] 3.1.1 `create(data, ctx)` — create user (Platform Admin: global; Tenant Admin: create + add to own org via Member join)
  - [ ] 3.1.2 `getById(id, ctx)` — retrieve user (Platform Admin: any; Tenant Admin: own org members only)
  - [ ] 3.1.3 `list(filters, pagination, ctx)` — paginated user list (Platform Admin: all users; Tenant Admin: own org members only, filtered via Member join)
  - [ ] 3.1.4 `update(id, data, ctx)` — update user (Platform Admin: any; Tenant Admin: own org members only)
  - [ ] 3.1.5 `delete(id, ctx)` — delete user (Platform Admin: any; Tenant Admin: own org members only, removes Member relationship first)
- [ ] 3.2 Implement authorization checks for each method using `base-service.ts` helpers
- [ ] 3.3 Handle `organizationId` scoping for Tenant Admin operations (filter by Member join table)
- [ ] 3.4 **TEST:** Write unit tests for `create` (verify Platform Admin vs Tenant Admin behavior)
- [ ] 3.5 **TEST:** Write unit tests for `getById` (verify scoping via Member join)
- [ ] 3.6 **TEST:** Write unit tests for `list` (verify pagination, filtering, scoping)
- [ ] 3.7 **TEST:** Write unit tests for `update` (verify validation, scoping)
- [ ] 3.8 **TEST:** Write unit tests for `delete` (verify scoping, Member relationship cleanup)
- [ ] 3.9 **INTEGRATION:** Test full CRUD flow against test database

## 4. RoleService
- [ ] 4.1 Create `services/role-service.ts` with:
  - **Model locality:** Org-scoped model, uses `tenantDb`. All methods take explicit `targetOrgId`.
  - [ ] 4.1.1 `create(data, targetOrgId, ctx)` — create role in specified org (use transaction for role + initial permissions)
  - [ ] 4.1.2 `getById(id, targetOrgId, ctx)` — retrieve role (scoped to org)
  - [ ] 4.1.3 `list(targetOrgId, filters, pagination, ctx)` — paginated role list within org
  - [ ] 4.1.4 `update(id, data, targetOrgId, ctx)` — update role (name, description)
  - [ ] 4.1.5 `delete(id, targetOrgId, ctx)` — delete role (with safety check: query MemberRole count; throw ConflictError if > 0)
- [ ] 4.2 Implement authorization checks for each method using `base-service.ts` helpers
- [ ] 4.3 **TEST:** Write unit tests for `create` (verify org scoping, Platform Admin flexibility)
- [ ] 4.4 **TEST:** Write unit tests for `getById` (verify org scoping)
- [ ] 4.5 **TEST:** Write unit tests for `list` (verify pagination, filtering)
- [ ] 4.6 **TEST:** Write unit tests for `update` (verify validation, scoping)
- [ ] 4.7 **TEST:** Write unit tests for `delete` (verify safety check — members assigned → ConflictError)
- [ ] 4.8 **TEST:** Write unit tests for `update`/`delete` (verify Redis cache invalidation call)
- [ ] 4.9 **INTEGRATION:** Test full CRUD flow against test database

## 5. PermissionService
- [ ] 5.1 Create `services/permission-service.ts` with:
  - **Model locality:** Global model, uses `globalDb`. Redis cache invalidated on mutations.
  - [ ] 5.1.1 `create(data, ctx)` — create global permission (Platform Admin only)
  - [ ] 5.1.2 `getById(id, ctx)` — retrieve permission (read-only for Tenant Admin)
  - [ ] 5.1.3 `list(filters, pagination, ctx)` — paginated global permission catalog (read-only for Tenant Admin)
  - [ ] 5.1.4 `update(id, data, ctx)` — update permission (key, resource, action, description; Platform Admin only)
    - **Must call `invalidatePermissionCache()` after successful update**
  - [ ] 5.1.5 `delete(id, ctx)` — delete permission (with safety check: query RolePermission count; throw ConflictError if > 0)
    - **Must call `invalidatePermissionCache()` after successful delete**
- [ ] 5.2 Implement authorization checks for each method using `base-service.ts` helpers
- [ ] 5.3 **TEST:** Write unit tests for `create` (verify Platform Admin only)
- [ ] 5.4 **TEST:** Write unit tests for `getById` (verify read-only for Tenant Admin)
- [ ] 5.5 **TEST:** Write unit tests for `list` (verify read-only for Tenant Admin)
- [ ] 5.6 **TEST:** Write unit tests for `update` (verify Platform Admin only; verify Redis cache invalidation call)
- [ ] 5.7 **TEST:** Write unit tests for `delete` (verify safety check — assigned to roles → ConflictError; verify Redis cache invalidation call)
- [ ] 5.8 **INTEGRATION:** Test full CRUD flow against test database

## 6. Integration with Existing API Routes
- [ ] 6.1 Refactor `app/api/admin/organizations/[orgId]/roles/route.ts` to use RoleService
  - Replace direct Prisma calls with `RoleService.create()`, `RoleService.list()`, etc.
  - Use `handleServiceError()` for error mapping
- [ ] 6.2 Refactor `app/api/admin/organizations/[orgId]/permissions/route.ts` to use PermissionService
  - Replace direct Prisma calls with `PermissionService.list()`, etc.
  - Use `handleServiceError()` for error mapping
- [ ] 6.3 **VERIFY:** All refactored routes still pass existing non-regression tests
- [ ] 6.4 **VERIFY:** All refactored routes still return correct HTTP status codes

## 7. End-to-End Tests
**Note:** Tenant Admin E2E tests are converted to integration tests (task group 8) because no tenant-admin-facing HTTP routes currently exist. The `/admin/*` routes are gated by `requireSuperAdmin()`, making Tenant Admin E2E flows unbuildable through the HTTP layer. Service-level integration tests verify the same authorization logic.

- [ ] 7.1 Create `tests/e2e/platform-admin-flow.test.ts`:
  - [ ] 7.1.1 Platform Admin logs in → creates organization → verifies creation
  - [ ] 7.1.2 Platform Admin logs in → creates user → verifies creation
  - [ ] 7.1.3 Platform Admin logs in → creates role in tenant org → verifies creation
  - [ ] 7.1.4 Platform Admin logs in → creates global permission → verifies creation
- [ ] 7.2 Create `tests/e2e/security-flow.test.ts`:
  - [ ] 7.2.1 Non-authenticated user attempts service operations → verifies 401
  - [ ] 7.2.2 Regular member (non-admin) attempts service operations → verifies 403

## 8. Integration Tests
- [ ] 8.1 Create `tests/integration/organization-service.integration.test.ts`
  - [ ] 8.1.1 Test full CRUD flow against test database
  - [ ] 8.1.2 Verify Tenant Admin cannot access another tenant's org (cross-org isolation)
- [ ] 8.2 Create `tests/integration/user-service.integration.test.ts`
  - [ ] 8.2.1 Test full CRUD flow against test database (globalDb)
  - [ ] 8.2.2 Verify Tenant Admin can only see own org members (Member join filtering)
- [ ] 8.3 Create `tests/integration/role-service.integration.test.ts`
  - [ ] 8.3.1 Test full CRUD flow against test database (tenantDb)
  - [ ] 8.3.2 Verify Tenant Admin cannot create roles in another org
  - [ ] 8.3.3 Verify delete safety check (ConflictError when members assigned)
  - [ ] 8.3.4 Verify Redis cache invalidation on update/delete
- [ ] 8.4 Create `tests/integration/permission-service.integration.test.ts`
  - [ ] 8.4.1 Test full CRUD flow against test database (globalDb)
  - [ ] 8.4.2 Verify Tenant Admin read-only access
  - [ ] 8.4.3 Verify delete safety check (ConflictError when assigned to roles)
  - [ ] 8.4.4 Verify Redis cache invalidation on update/delete

## 9. Non-Regression Verification
- [ ] 9.1 Existing `/admin/organizations` list view still works
- [ ] 9.2 Existing `/api/admin/organizations/route.ts` still works
- [ ] 9.3 Existing tenant management endpoints under `/api/admin/organizations/[orgId]/...` still work
- [ ] 9.4 Existing RBAC permission resolution still works (no regression in auth-and-rbac)
- [ ] 9.5 Existing tenant isolation still works (no regression in Prisma Extension)
