# Proposal: Data Model Services

## Intent
Establish a standardized, secure service layer for all core data models (Organization, User, Role, Permission) that enforces CRUD operations with tenant isolation and role-based authorization at the service level. This proposal replaces direct Prisma calls in API routes with dedicated service objects, providing a single source of truth for business logic and authorization checks.

Currently, only `OrganizationService` exists with partial CRUD (pagination + create). This proposal expands it to full CRUD and creates equivalent services for User, Role, and Permission models.

## References & Foundational Rules
This proposal builds upon and must strictly adhere to the rules, design system, and infrastructure established in:

- **`project-initialization`**: Core architecture, tenant isolation strategy (Prisma Extension + RLS), BetterAuth setup, version pinning, and secrets management.
- **`basic-authentication-login-flow`**: Login flow, session management, cookie handling (dot and dash variants), logout mechanics, and cross-tab invalidation.
- **`auth-and-rbac`**: RBAC engine, permission catalog (`resource:action` syntax), Redis caching with 5-min TTL, Platform Organization security, session augmentation, `usePermission` hooks, `<RequirePermission>` component, and automatic role bootstrapping.
- **`super-admin-org-mgmt`**: Existing Super Admin dashboard, global DB client (`lib/global-db.ts`), `requireSuperAdmin()` guards.
- **`super-admin-tenant-management`**: Existing Super Admin tenant management API endpoints and UI pages.

**Mandatory Rules Enforced:**
- **Unified Architecture:** Single Next.js origin. No separate backend servers.
- **Version Pinning:** Node.js 22 LTS, Next.js 15, React 19, Vitest 4.x.
- **Database & ORM:** PostgreSQL only, Prisma ORM.
- **Tenant Isolation:** `organizationId` is mandatory on all organization-scoped models. The defense-in-depth strategy (Prisma Extension + RLS) must not be bypassed except through explicitly guarded Super Admin pathways.
- **Secrets Management:** No real secrets committed to GitHub. Use `.env.example` for new variables.
- **Test-Driven Completeness:** No code is considered "done" without passing tests. Every new library function, API route, and UI component must have corresponding unit tests. Integration tests must verify end-to-end flows.
- **Strict Property NI Design System Compliance:** ALL UI components MUST use the Property NI color palette. Navy (`#1B2A4A`) for primary elements. Amber (`#F5A623`) for accents, CTAs, and highlights. NO exceptions.
- **Import Path & Casing Consistency:** All imports MUST use correct PascalCase for component names. Import paths MUST use `@/` alias and match exact file casing.
- **Edge vs. Node Runtime Boundaries:** Middleware MUST NOT import Prisma or ioredis directly. Use cookie-only validation in middleware. Server components and API routes MUST lazy-load Node.js dependencies when called from Edge Runtime contexts. **Services must never be imported from client components or middleware** (Edge runtime boundary).
- **Strict Platform Organization Gating:** All `/admin/*` pages, components, and API routes MUST be restricted exclusively to members of the Platform (Super Admin) Organization.

## Non-Regression Requirements
This proposal MUST NOT break any functionality established in previous proposals:
- **Auth:** Cookie clearing, database session invalidation, full page reload on logout, cross-tab session invalidation.
- **AuthZ:** Permission resolution with Redis caching, session augmentation, automatic role bootstrapping, Platform Organization security guard.
- **Project:** Prisma Extension tenant isolation, additive/non-destructive migrations.
- **Super Admin Org Mgmt:** Existing `/admin/organizations` list view, existing admin API routes must continue to function.
- **Super Admin Tenant Mgmt:** Existing tenant management endpoints under `/api/admin/organizations/[orgId]/...` must continue to function.

## Scope

**In Scope:**
1. **Standardized Service Interface Definition** — A shared `ServiceContext` interface and base patterns that all CRUD services must implement:
   - `create(data, context)` — Create a new record
   - `getById(id, targetOrgId?, context)` — Retrieve a single record by ID
   - `list(filters, pagination, targetOrgId?, context)` — Retrieve paginated records with filtering
   - `update(id, data, targetOrgId?, context)` — Modify an existing record
   - `delete(id, targetOrgId?, context)` — Remove a record

2. **`OrganizationService` Refactor** — Upgrade existing service to full CRUD:
   - Add `getOrganizationById()`, `updateOrganization()`, `deleteOrganization()`
   - Implement authorization checks (Platform Admin: full access; Tenant Admin: read-only own org)
   - Preserve existing `createOrganization()` and `getPaginatedOrganizations()` logic

3. **`UserService`** — New CRUD service for the `User` model:
   - **Model locality:** The `User` model is a **global** (non-org-scoped) Prisma model. UserService uses `globalDb` for all queries, not `tenantDb`. Tenant Admin access is enforced by filtering through the `Member` join table (i.e., a Tenant Admin can only see/manage users who are members of their organization).
   - `create()` — Create user (Platform Admin: global; Tenant Admin: create and add to own org)
   - `getById()` — Retrieve user by ID (Platform Admin: any; Tenant Admin: own org members only)
   - `list()` — Paginated user list with filtering (Platform Admin: all users; Tenant Admin: own org members only)
   - `update()` — Update user (Platform Admin: any; Tenant Admin: own org members only)
   - `delete()` — Delete user (Platform Admin: any; Tenant Admin: own org members only)

4. **`RoleService`** — New CRUD service for the `Role` model (organization-scoped):
   - **Model locality:** The `Role` model is org-scoped (`organizationId` required). RoleService uses `tenantDb` within a tenant context.
   - All methods take an explicit `targetOrgId` parameter (never derived from `ctx.organizationId`, because a Platform Admin's ctx org is the Platform org, not the target).
   - **Redis cache invalidation:** Every `update()` and `delete()` call must invalidate the Redis permission cache (same mechanism as PermissionService).
   - `create(data, targetOrgId, context)` — Create role in specified org
   - `getById(id, targetOrgId, context)` — Retrieve role (scoped to org)
   - `list(targetOrgId, filters, pagination, context)` — Paginated role list within org
   - `update(id, data, targetOrgId, context)` — Update role (name, description; invalidates Redis cache)
   - `delete(id, targetOrgId, context)` — Delete role (with safety check: warn if members assigned; invalidates Redis cache)

5. **`PermissionService`** — New CRUD service for the `Permission` model (global master catalog):
   - **Model locality:** The `Permission` model is a **global** (non-org-scoped) Prisma model. PermissionService uses `globalDb`.
   - **Redis cache invalidation:** Every `update()` and `delete()` call must invalidate the Redis permission cache for all affected organizations. This is critical — a deleted or modified permission remains effective for up to 5 minutes without invalidation, creating a security gap.
   - `create(data, context)` — Create a new global permission (Platform Admin only)
   - `getById(id, context)` — Retrieve permission by ID (read-only for Tenant Admin)
   - `list(filters, pagination, context)` — Paginated global permission catalog (read-only for Tenant Admin)
   - `update(id, data, context)` — Update permission (key, resource, action, description; Platform Admin only)
   - `delete(id, context)` — Delete permission (with safety check: warn if assigned to roles; Platform Admin only)

6. **Authorization Layer** — Service-level authorization using `ServiceContext`:
   - Platform Admin: authorized to act on any organization or global models
   - Tenant Admin: authorized only within their own `organizationId` (for org-scoped models) or for members of their organization (for global models like User)
   - **MEMBER role:** All service operations are denied by default for `MEMBER` users. Throws `ForbiddenError`.
   - Authorization errors throw typed exceptions (`UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `ValidationError`)
   - Failed authorization attempts are logged at the service layer for security observability

7. **Integration with Existing API Routes** — Refactor existing admin API routes to use the new services instead of direct Prisma calls

8. **Comprehensive Testing** — Unit tests, integration tests, and E2E tests for all services

**Out of Scope (Deferred):**
- Member management service (covered by `super-admin-tenant-management` proposal)
- Invitation/SentInvitation services
- AuditLog/NotificationLog services (audit logging is referenced in existing proposals but not part of this one)
- Bulk operations (bulk create, bulk update)
- Service-to-service composition patterns (e.g., a service that orchestrates multiple CRUD operations across models)

## Files to Create or Modify

| Type | File Path | Purpose |
|------|-----------|---------|
| New | `lib/services/types.ts` | Shared service interfaces (`ServiceContext`, pagination, error types) |
| New | `lib/services/base-service.ts` | Authorization helper functions and shared utilities |
| New | `lib/services/error-handler.ts` | Shared error→HTTP-response mapper for API routes |
| Modified | `services/organization-service.ts` | Refactor to full CRUD with authorization checks |
| New | `services/user-service.ts` | Full CRUD service for User model (global, via globalDb) |
| New | `services/role-service.ts` | Full CRUD service for Role model (org-scoped, via tenantDb) |
| New | `services/permission-service.ts` | Full CRUD service for Permission model (global, via globalDb) |
| Modified | `app/api/admin/organizations/[orgId]/roles/route.ts` | Refactor to use RoleService |
| Modified | `app/api/admin/organizations/[orgId]/permissions/route.ts` | Refactor to use PermissionService |

## Testing Plan

- **Unit tests** for each service method:
  - Mock `tenantDb` and `globalDb`; verify correct Prisma queries are called
  - Verify authorization logic: Platform Admin vs. Tenant Admin vs. MEMBER behavior
  - Verify error handling: `ForbiddenError`, `NotFoundError`, `ConflictError`, `ValidationError`
  - Verify pagination, filtering, and sorting logic

- **Integration tests**:
  - Real database interactions (using test DB) to verify `organizationId` scoping
  - Verify transaction integrity for multi-step operations (e.g., create org + admin user)
  - Verify that Tenant Admin cannot access another tenant's data

- **End-to-end tests**:
  - Platform Admin flow: login → create org → create user → create role → assign permission
  - Security flow: non-admin user gets 403 on all service operations

- **Non-regression tests**:
  - Existing `/api/admin/organizations/route.ts` still works
  - Existing tenant management endpoints under `/api/admin/organizations/[orgId]/...` still work

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing API routes that call Prisma directly | High | Refactor routes incrementally; keep old routes working during transition; add integration tests |
| Authorization logic complexity leading to security gaps | Critical | Implement comprehensive unit + integration tests for all authorization paths; peer review |
| Performance regression from service layer abstraction | Medium | Profile before/after; ensure Prisma queries are not N+1; use `tenantDb` efficiently |
| Service method signature changes breaking callers | Medium | Define stable interfaces in `types.ts`; use TypeScript strict mode; update all callers in same PR |
| Redis cache stale after permission/role mutations (up to 5 min) | High | Explicitly invalidate Redis cache on every `update()`/`delete()` in PermissionService and RoleService |
| Accidental org deletion cascading through tenant data | Critical | `deleteOrganization` requires explicit confirmation; throws ConflictError if members exist; Platform Organization is protected from deletion |
