# Proposal: Integrated Super Admin Dashboard

## Intent

Build a new, unified Super Admin dashboard at `/dashboard/admin` that consolidates CRUD operations and relationship management for Organizations, Users, Teams, Roles, and Permissions into a single integrated interface. This dashboard connects directly to the existing data model services (`OrganizationService`, `UserService`, `TeamService`, `RoleService`, `PermissionService`) to provide live data access, replacing the fragmented current `/admin/*` pages with a cohesive experience.

The key differentiator from the existing Super Admin dashboard is **relationship-aware management**: Users can be assigned to Teams with inherited Roles; Roles are linked to Permissions (1-to-many); Organizations contain Teams which contain Users. All these relationships are managed through the new dashboard's UI and backed by dedicated REST endpoints.

This proposal builds on the service layer established in `data-model-services` and the Teams integration from `betterauth-teams-integration`, providing a polished, corporate-grade UI that respects the Property NI design system.

## References & Foundational Rules

This proposal builds upon and must strictly adhere to the rules, design system, and infrastructure established in:

- **`project-initialization`**: Core architecture, tenant isolation strategy (Prisma Extension + RLS), BetterAuth setup, version pinning, and secrets management.
- **`basic-authentication-login-flow`**: Login flow, session management, cookie handling (dot and dash variants), logout mechanics, and cross-tab invalidation.
- **`auth-and-rbac`**: RBAC engine, permission catalog (`resource:action` syntax), Redis caching with 5-min TTL, Platform Organization security, session augmentation, `usePermission` hooks, `<RequirePermission>` component, and automatic role bootstrapping.
- **`super-admin-org-mgmt`**: Existing Super Admin dashboard at `/admin/*`, global DB client (`lib/global-db.ts`), `requireSuperAdmin()` guards, audit logging infrastructure.
- **`betterauth-teams-integration`**: Team model (`Team`, `TeamMember`, `TeamRole`), team CRUD APIs, role inheritance via teams.
- **`data-model-services`**: Standardized service layer (`OrganizationService`, `UserService`, `RoleService`, `PermissionService`) with `ServiceContext` interface, authorization checks, and Redis cache invalidation.

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
- **No Changes to Existing Auth Pages:** The existing login page (`app/login/page.tsx`), register page, and all BetterAuth auth flows remain untouched.
- **No Changes to Existing Admin Dashboard:** The current `/admin/*` dashboard remains in place and fully functional. This is a parallel, new dashboard.

## Non-Regression Requirements

This proposal MUST NOT break any functionality established in previous proposals:
- **Auth:** Cookie clearing, database session invalidation, full page reload on logout, cross-tab session invalidation.
- **AuthZ:** Permission resolution with Redis caching, session augmentation, automatic role bootstrapping, Platform Organization security guard.
- **Project:** Prisma Extension tenant isolation, additive/non-destructive migrations.
- **Super Admin Org Mgmt:** Existing `/admin/organizations` list view, existing admin API routes must continue to function.
- **Super Admin Tenant Mgmt:** Existing tenant management endpoints under `/api/admin/organizations/[orgId]/...` must continue to function.
- **Teams Integration:** Existing team CRUD APIs under `/api/organizations/[orgId]/teams/*` must continue to function.
- **Data Model Services:** Existing service layer methods (`OrganizationService`, `UserService`, `RoleService`, `PermissionService`) must continue to work unchanged.

## Scope

**In Scope:**
1. **New Dashboard Route Group** — `/dashboard/admin` with its own layout, sidebar navigation, and content area. Separate from the existing `/admin/*` dashboard.
2. **Collapsible Sidebar** — Navy (`#1B2A4A`) sidebar that slides in/out (like the mockup), with icons for Users, Organizations, Teams, Roles, Permissions. Uses `lucide-react` icons.
3. **Light Content Area** — Corporate/enterprise aesthetic with `#f8f9fa` background, clean whites, subtle borders.
4. **Organizations Panel** — Full CRUD via `OrganizationService`. List view with search, filter by status. Detail view showing org info, members, teams, roles. Create/Edit forms with validation via Zod schemas.
5. **Users Panel** — Full CRUD via `UserService`. Table with search, filter by ban status/email verified. Detail view showing user info, assigned roles, organization memberships. Ban/unban actions.
6. **Teams Panel** — Full CRUD via `TeamService`. List teams per organization. Create/Edit forms (name, slug, description). Manage team membership (add/remove users). Assign/revoke default roles to teams.
7. **Roles Panel** — Full CRUD via `RoleService`. List roles per organization. Create/Edit forms (name, description). Assign/remove permissions to/from roles (1-to-many relationship UI with multi-select). View assigned members.
8. **Permissions Panel** — Full CRUD via `PermissionService`. Global catalog view with search/filter. Create/Edit permissions (`resource:action` syntax). View which roles use each permission.
9. **Relationship Management UI** — Dedicated components for managing the key relationships:
   - User ↔ Roles (multi-select assignment)
   - Role ↔ Permissions (1-to-many, multi-select)
   - Organization → Teams (list + create)
   - Team → Users (add/remove membership)
   - Team → Default Roles (assign/revoke inheritance)
10. **New REST API Endpoints** — Dedicated endpoints under `/api/dashboard/admin/*` for all CRUD operations, connected to the service layer.
11. **Stat Cards** — Summary cards at the top of each panel showing key metrics (total count, active counts, etc.).
12. **Shared UI Components** — Reusable components: `DataTable`, `StatCard`, `SearchBar`, `StatusBadge`, `ConfirmDialog`, `Modal`, `MultiSelect`.
13. **Testing** — Unit tests for all new API routes and service integrations, integration tests for CRUD flows.

**Out of Scope (Deferred):**
- Analytics/Charts panel (no recharts integration).
- Audit Logs panel (existing `/admin/audit-logs` covers this).
- Sessions management.
- Bulk operations (select multiple rows for batch actions).
- Team invitation UI (backend APIs exist, UI deferred).
- Real-time updates / SSE integration in the new dashboard.
- Dark mode toggle.

### Requirement: Super Admin Gating (Platform Organization Only)

All routes and UI elements in this proposal MUST be restricted exclusively to Super Admin users who are members of the Platform Organization. This gating uses the same patterns established in the existing `/admin/*` dashboard.

**Server-side (API routes):**
- Every API route under `/api/dashboard/admin/*` MUST call `requireSuperAdmin()` from `lib/require-super-admin.ts` at the top of the route handler.
- `requireSuperAdmin()` performs fail-closed verification: it calls `verifySuperAdmin(session.user.id)` which checks Platform Organization membership via the global DB client.
- If no session exists: return 401 Unauthorized.
- If user is not a Platform Organization member: return 403 Forbidden (or 503 if database is unavailable).
- Reference implementation: `lib/require-super-admin.ts` — the exact same function used by all existing `/admin/*` API routes.

**Client-side (UI pages/layouts):**
- The dashboard layout (`app/dashboard/admin/layout.tsx`) MUST wrap all page content in the `<RequireSuperAdmin>` component from `components/auth/RequireSuperAdmin.tsx`.
- `<RequireSuperAdmin>` uses the `useIsSuperAdmin()` hook to check Platform Organization membership on the client.
- If the user is not a Super Admin, `<RequireSuperAdmin>` renders `<AccessDenied />` (from `components/admin/AccessDenied.tsx`) as the fallback.
- Reference implementation: `app/admin/layout.tsx` wraps children in `<RequireSuperAdmin>`; the same pattern MUST be used.

**Navigation sidebar:**
- Sidebar navigation links MUST only be rendered for Super Admin users. The `useIsSuperAdmin()` hook should gate visibility of the sidebar itself or individual links.
- Non-Super-Admin users who somehow reach `/dashboard/admin` MUST see `<AccessDenied />` and be unable to interact with any dashboard content.

**Test coverage:**
- Unit tests MUST verify that non-Super-Admin users receive 403 Forbidden when calling any `/api/dashboard/admin/*` endpoint.
- Integration tests MUST verify that the `<RequireSuperAdmin>` component renders `<AccessDenied />` for non-Super-Admin users and renders children for Super Admin users.

## Execution Boundary

This proposal will generate:
1. **New route group** — `app/dashboard/admin/` with layout and page components for each panel.
2. **New API routes** — `/api/dashboard/admin/*` endpoints connected to service layer.
3. **New shared components** — `components/dashboard/` with reusable UI primitives.
4. **No changes to existing files** — The current `/admin/*` dashboard, login page, and all auth flows remain untouched.
5. **No new database schema changes** — Uses existing models and relationships from prior proposals.

## Approach

Build a new Next.js App Router route group at `app/dashboard/admin/` with its own layout featuring a collapsible navy sidebar and light content area. Each panel (Users, Organizations, Teams, Roles, Permissions) is a client component that fetches data via the existing service layer through dedicated API routes. Relationship management uses multi-select components and modal dialogs. All UI follows the Property NI Navy/Amber design system with a corporate/enterprise aesthetic (clean whites, subtle borders).
