# Tasks

## 0. Pre-Implementation Verification
- [ ] 0.1 Verify `lib/global-db.ts` is importable and functional for cross-org queries
- [ ] 0.2 Verify `lib/require-super-admin.ts` exports `requireSuperAdmin()` used by existing dashboard API routes
- [ ] 0.3 Verify `services/resource-service.ts` does not yet exist (confirm it is a new service)
- [ ] 0.4 Verify existing dashboard sidebar (`app/dashboard/admin/layout.tsx`) navItems array structure
- [ ] 0.5 Verify existing dashboard API route pattern (`requireSuperAdmin` → service delegation)

## 1. Prisma Schema Changes
- [ ] 1.1 Add `Resource` model to `prisma/schema.prisma`:
  - [ ] 1.1.1 Fields: `id` (cuid), `name` (string, unique), `description` (string?), timestamps
  - [ ] 1.1.2 Mark as global model (no `organizationId`)
- [ ] 1.2 Add `ResourceRole` junction model to `prisma/schema.prisma`:
  - [ ] 1.2.1 Fields: `id` (cuid), `resourceId`, `roleId`, timestamps
  - [ ] 1.2.2 Relations: `resource → Resource` (onDelete: Cascade), `role → Role` (onDelete: Cascade)
  - [ ] 1.2.3 Unique constraint on `[resourceId, roleId]`
  - [ ] 1.2.4 Mark as global model (no `organizationId`)
- [ ] 1.3 Update existing models with relations:
  - [ ] 1.3.1 Add `resourceRoles ResourceRole[]` to `Organization` model (via the global junction table)
  - [ ] 1.3.2 Add `resources ResourceRole[]` to `Role` model (via the global junction table)
- [ ] 1.4 **TEST:** Run `prisma validate` to confirm schema is valid
- [ ] 1.5 **TEST:** Run `prisma generate` to regenerate the Prisma client

## 2. ResourceService
- [ ] 2.1 Create `services/resource-service.ts`:
  - [ ] 2.1.1 Define input types: `CreateResourceInput`, `UpdateResourceInput`
  - [ ] 2.1.2 Define filter type: `ResourceFilters` (extends `BaseFilters`, adds no org-specific filters)
  - [ ] 2.1.3 `create(data, ctx)` — create resource with optional role assignments
    - Uses `globalDb.$transaction()` for atomic create + role assignment
    - Validates name uniqueness (case-insensitive)
    - Requires `PLATFORM_ADMIN` role
  - [ ] 2.1.4 `getById(id, ctx)` — retrieve resource with `resourceRoles` relation populated
    - Requires `PLATFORM_ADMIN` role
  - [ ] 2.1.5 `list(filters, pagination, ctx)` — paginated list with search by name
    - Requires `PLATFORM_ADMIN` role
  - [ ] 2.1.6 `update(id, data, ctx)` — update name/description; if `roleIds` provided, replaces all assignments
    - Uses `globalDb.$transaction()` for atomic role replacement
    - Requires `PLATFORM_ADMIN` role
  - [ ] 2.1.7 `delete(id, ctx)` — delete resource with safety check
    - Queries `ResourceRole` count; throws `ConflictError` if > 0
    - Requires `PLATFORM_ADMIN` role
- [ ] 2.2 Implement authorization checks using `requirePlatformAdmin(ctx)` from `lib/services/base-service.ts`
- [ ] 2.3 Use `globalDb` for all database queries (both models are global)
- [ ] 2.4 Log create/update/delete actions for security observability

## 3. Unit Tests — ResourceService
- [ ] 3.1 Create `tests/unit/resource-service.test.ts`
- [ ] 3.2 **TEST:** `create()` — Platform Admin can create a resource
- [ ] 3.3 **TEST:** `create()` — Platform Admin can create a resource with role assignments
- [ ] 3.4 **TEST:** `create()` — Non-Platform Admin (TENANT_ADMIN) gets ForbiddenError
- [ ] 3.5 **TEST:** `create()` — Non-Platform Admin (MEMBER) gets ForbiddenError
- [ ] 3.6 **TEST:** `create()` — Duplicate name (case-insensitive) gets ConflictError
- [ ] 3.7 **TEST:** `create()` — Missing name gets ValidationError
- [ ] 3.8 **TEST:** `getById()` — Returns resource with role assignments
- [ ] 3.9 **TEST:** `getById()` — NotFoundError when resource does not exist
- [ ] 3.10 **TEST:** `list()` — Returns paginated results with search filter
- [ ] 3.11 **TEST:** `list()` — Returns all resources when no search filter
- [ ] 3.12 **TEST:** `update()` — Updates name and description
- [ ] 3.13 **TEST:** `update()` — Replaces role assignments when `roleIds` provided
- [ ] 3.14 **TEST:** `delete()` — Deletes resource with no assigned roles
- [ ] 3.15 **TEST:** `delete()` — ConflictError when resource has assigned roles
- [ ] 3.16 **TEST:** `delete()` — NotFoundError when resource does not exist

## 4. API Routes
- [ ] 4.1 Create `app/api/dashboard/admin/resources/route.ts`:
  - [ ] 4.1.1 `GET` — list resources with pagination and search, delegates to `ResourceService.list()`
  - [ ] 4.1.2 `POST` — create resource, validates body fields, delegates to `ResourceService.create()`
  - [ ] 4.1.3 Both methods call `requireSuperAdmin(request.headers)` at the top
  - [ ] 4.1.4 Set `export const runtime = 'nodejs'`
- [ ] 4.2 Create `app/api/dashboard/admin/resources/[id]/route.ts`:
  - [ ] 4.2.1 `GET` — get resource detail with role assignments, delegates to `ResourceService.getById()`
  - [ ] 4.2.2 `PATCH` — update resource, delegates to `ResourceService.update()`
  - [ ] 4.2.3 `DELETE` — delete resource, delegates to `ResourceService.delete()`
  - [ ] 4.2.4 All methods call `requireSuperAdmin(request.headers)` at the top
  - [ ] 4.2.5 Set `export const runtime = 'nodejs'`
- [ ] 4.3 Handle error responses: map service errors to appropriate HTTP status codes (400, 403, 404, 409)

## 5. UI — Resources Page
- [ ] 5.1 Create `app/dashboard/admin/resources/page.tsx`:
  - [ ] 5.1.1 Client component (`'use client'`)
  - [ ] 5.1.2 Imports: `PageHeader`, `StatCard`, `SearchBar`, `DataTable`, `Modal`, `ConfirmDialog` from dashboard components
  - [ ] 5.1.3 State: resources list, pagination, search, loading, error
  - [ ] 5.1.4 Modal states: create modal, edit modal, detail modal, delete confirmation
  - [ ] 5.1.5 Fetch resources on mount and when search/pagination changes
  - [ ] 5.1.6 Create form: name (required), description (optional)
  - [ ] 5.1.7 Edit form: name, description
  - [ ] 5.1.8 Role assignment UI: multi-select showing available roles across all organizations
  - [ ] 5.1.9 Delete confirmation dialog with safety message ("This resource has X roles assigned. Remove them first.")
  - [ ] 5.1.10 StatCards: total resources count, total role assignments count
- [ ] 5.2 Follow the same layout pattern as `app/dashboard/admin/permissions/page.tsx`:
  - Same component imports, same state management pattern, same modal structure

## 6. UI — Sidebar Menu Item
- [ ] 6.1 Update `app/dashboard/admin/layout.tsx`:
  - [ ] 6.1.1 Import `Layers` from `lucide-react`
  - [ ] 6.1.2 Add `{ href: '/dashboard/admin/resources', label: 'Resources', icon: Layers }` to `navItems` array
  - [ ] 6.1.3 Place after the "Permissions" entry (at the end of the array)
- [ ] 6.2 Verify sidebar renders correctly with the new item (active state highlighting works)

## 6b. Spec Completeness Review
- [ ] 6b.1 Verify `specs/resource-data-model/spec.md` covers all schema, service, and API route requirements
- [ ] 6b.2 Verify `specs/resource-ui/spec.md` covers all page, modal, sidebar, and design system requirements
- [ ] 6b.3 Verify every scenario uses GIVEN/WHEN/THEN format consistently
- [ ] 6b.4 Verify authorization scenarios cover PLATFORM_ADMIN, TENANT_ADMIN, MEMBER, and unauthenticated cases

## 7. Final Verification
- [ ] 7.1 Run `prisma validate` — schema is valid
- [ ] 7.2 Run `npm run type-check` (`tsc --noEmit`) — no TypeScript errors
- [ ] 7.3 Run `npm run lint` — no ESLint violations
- [ ] 7.4 Run unit tests (`npm test`) — all new tests pass
- [ ] 7.5 Verify existing dashboard panels still render (non-regression)
