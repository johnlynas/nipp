# Proposal: Resource Data Model

## Intent

Introduce a global `Resource` data model that wraps portal features/modules, controlling which organization-scoped roles can access them. A `Resource` represents a feature area (e.g., "Maintenance Requests", "Work Orders") and is linked to roles via a new `ResourceRole` junction table. When a user attempts to access a feature, the system checks whether their org-scoped role is mapped to that Resource — if not, access is denied.

This generalizes the current platform-level permission wrappers by providing a feature-centric access control layer that sits alongside (but is independent of) the existing `Role` → `Permission` chain.

## References & Foundational Rules

This proposal builds upon and must strictly adhere to the rules, design system, and infrastructure established in:

- **`project-initialization`**: Core architecture, tenant isolation strategy (Prisma Extension + RLS), BetterAuth setup, version pinning, and secrets management.
- **`basic-authentication-login-flow`**: Login flow, session management, cookie handling (dot and dash variants), logout mechanics, and cross-tab invalidation.
- **`auth-and-rbac`**: RBAC engine, permission catalog (`resource:action` syntax), Redis caching with 5-min TTL, Platform Organization security, session augmentation, `usePermission` hooks, `<RequirePermission>` component, and automatic role bootstrapping.
- **`super-admin-org-mgmt`**: Existing Super Admin dashboard at `/admin/*`, global DB client (`lib/global-db.ts`), `requireSuperAdmin()` guards, audit logging infrastructure.
- **`betterauth-teams-integration`**: Team model (`Team`, `TeamMember`, `TeamRole`), team CRUD APIs, role inheritance via teams.
- **`data-model-services`**: Standardized service layer (`OrganizationService`, `UserService`, `RoleService`, `PermissionService`) with `ServiceContext` interface, authorization checks, and Redis cache invalidation.
- **`integrated-super-admin-dashboard`**: Dashboard route group at `/dashboard/admin/`, shared UI components (`DataTable`, `PageHeader`, `StatCard`, etc.), sidebar navigation pattern, and API route conventions.

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
- **Strict Platform Organization Gating:** All `/dashboard/admin/*` pages, components, and API routes MUST be restricted exclusively to members of the Platform (Super Admin) Organization.

## Non-Regression Requirements

This proposal MUST NOT break any functionality established in previous proposals:
- **Auth:** Cookie clearing, database session invalidation, full page reload on logout, cross-tab session invalidation.
- **AuthZ:** Permission resolution with Redis caching, session augmentation, automatic role bootstrapping, Platform Organization security guard.
- **Project:** Prisma Extension tenant isolation, additive/non-destructive migrations.
- **Super Admin Org Mgmt:** Existing `/admin/organizations` list view, existing admin API routes must continue to function.
- **Integrated Dashboard:** Existing dashboard panels (Users, Organizations, Teams, Roles, Permissions) must continue to function unchanged.

## Scope

**In Scope:**
1. **Prisma Schema Additions** — New `Resource` model (global) and `ResourceRole` junction table (global):
   - `Resource`: `id`, `name`, `description`, timestamps. Global model (not org-scoped).
   - `ResourceRole`: Junction table linking a `Resource` to one or more org-scoped `Role`s. Global model with foreign keys to both `Resource` and `Role`.
   - Add relations on existing models: `Organization` gets a `resourceRoles` relation (via the global `ResourceRole` table).

2. **Service Layer** — New `services/resource-service.ts` with full CRUD:
   - `create(data, ctx)` — Create a new resource (Platform Admin only)
   - `getById(id, ctx)` — Retrieve resource by ID with assigned roles (Platform Admin only)
   - `list(filters, pagination, ctx)` — Paginated resource list with search (Platform Admin only)
   - `update(id, data, ctx)` — Update resource name/description (Platform Admin only)
   - `delete(id, ctx)` — Delete a resource (with safety check: warn if roles are assigned) (Platform Admin only)
   - Authorization follows the same pattern as `PermissionService` — all operations require `PLATFORM_ADMIN` role.

3. **API Routes** — REST endpoints under `/api/dashboard/admin/resources/...`:
   - `GET /api/dashboard/admin/resources` — List resources with pagination and search
   - `POST /api/dashboard/admin/resources` — Create a new resource
   - `GET /api/dashboard/admin/resources/[id]` — Get resource detail with assigned roles
   - `PATCH /api/dashboard/admin/resources/[id]` — Update resource
   - `DELETE /api/dashboard/admin/resources/[id]` — Delete a resource
   - All routes gated by `requireSuperAdmin()` from `lib/require-super-admin.ts`.

4. **UI — Resources Page** — New page at `/dashboard/admin/resources`:
   - Follows the same layout pattern as existing dashboard pages (`/dashboard/admin/permissions`, `/dashboard/admin/roles`).
   - Uses shared components: `PageHeader`, `StatCard`, `SearchBar`, `DataTable`, `Modal`, `ConfirmDialog`.
   - Features: list view with search, create/edit/delete modals, display of assigned roles per resource.

5. **UI — Sidebar Menu Item** — New entry in the dashboard sidebar (`app/dashboard/admin/layout.tsx`):
   - Label: "Resources"
   - Icon: `Layers` from `lucide-react` (appropriate for a feature/module grouping concept)
   - Route: `/dashboard/admin/resources`
   - Placed after "Permissions" in the nav order.

6. **Unit Tests** — Service unit tests:
   - Mock `globalDb`; verify correct Prisma queries are called.
   - Verify authorization logic: Platform Admin access granted, all other roles denied with `ForbiddenError`.
   - Verify error handling: `NotFoundError`, `ConflictError` (when roles are assigned), `ValidationError`.
   - Verify pagination, filtering, and sorting logic.

**Out of Scope (Deferred):**
- Integration with actual feature pages to check Resource access before rendering.
- API routes for managing the `ResourceRole` assignments (assigning/removing roles to/from a resource) — these are handled via the `update` method's role assignment field.
- UI for bulk operations (select multiple rows for batch actions).
- Data-in-transit payload encryption for Resources endpoints.
- Migration of existing code to use the Resource model — this proposal creates only the skeleton.

## Files to Create or Modify

| Type | File Path | Purpose |
|------|-----------|---------|
| Modified | `prisma/schema.prisma` | Add `Resource` and `ResourceRole` models, update relations on existing models |
| New | `services/resource-service.ts` | Full CRUD service for Resource model (global, via globalDb) |
| New | `app/api/dashboard/admin/resources/route.ts` | GET (list), POST (create) for resources |
| New | `app/api/dashboard/admin/resources/[id]/route.ts` | GET (detail), PATCH (update), DELETE for resource by ID |
| New | `app/dashboard/admin/resources/page.tsx` | Resources management page (list, create, edit, delete) |
| Modified | `app/dashboard/admin/layout.tsx` | Add "Resources" sidebar nav item with `Layers` icon |
| New | `tests/unit/resource-service.test.ts` | Unit tests for ResourceService CRUD operations |

## Testing Plan

- **Unit tests** for `ResourceService`:
  - Mock `globalDb`; verify correct Prisma queries are called for each CRUD method.
  - Verify authorization logic: `PLATFORM_ADMIN` access granted, `TENANT_ADMIN` and `MEMBER` denied with `ForbiddenError`.
  - Verify error handling: `NotFoundError` (resource not found), `ConflictError` (cannot delete resource with assigned roles), `ValidationError` (missing required fields).
  - Verify pagination, filtering (search by name), and sorting logic.

- **Integration tests** (deferred to a follow-up proposal):
  - Real database interactions to verify `Resource` and `ResourceRole` CRUD.
  - Verify that the global DB client is used correctly (no tenant context needed).

- **Non-regression tests**:
  - Existing dashboard panels (Users, Organizations, Teams, Roles, Permissions) continue to function.
  - Existing `/admin/*` dashboard continues to function.

## Specifications

Detailed acceptance criteria are defined in the following spec files:

- **`specs/resource-data-model/spec.md`** — Prisma schema, ResourceService CRUD methods (create, getById, list, update, delete), authorization guards, and all API route endpoints (`GET/POST /api/dashboard/admin/resources`, `GET/PATCH/DELETE /api/dashboard/admin/resources/[id]`).
- **`specs/resource-ui/spec.md`** — Resources page rendering, list view with search/pagination, create/edit/delete modals, detail view, sidebar navigation item, and Property NI design system compliance.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `ResourceRole` links a global model (`Resource`) to an org-scoped model (`Role`) — Prisma relation constraints | Medium | Use explicit foreign key fields on `ResourceRole` (`resourceId`, `roleId`) with proper `@relation` annotations. The `organizationId` on `ResourceRole` is not needed since the table itself is global; org scoping is enforced via the `roleId` → `Role.organizationId` chain. |
| Breaking existing dashboard sidebar navigation | Low | Add the new nav item at the end of the `navItems` array; no existing items are modified. |
| Service method signature changes breaking callers | Low | No existing code calls `ResourceService` — it is a new service. Define stable interfaces in the service file from the start. |
| Accidental resource deletion removing role access mappings | Medium | `delete()` includes a safety check: queries `ResourceRole` count for the resource; throws `ConflictError` if roles are assigned. |
