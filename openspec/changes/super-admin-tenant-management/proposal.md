# Proposal: Super Admin Tenant Management

## Intent
Enable Super Admins to fully manage any tenant organization — viewing and modifying all data within a tenant org as a "Unix root" user. This proposal adds dedicated API endpoints and UI pages under `/admin/organizations/[orgId]/...` that allow Super Admins to inspect and mutate tenant organization data (members, roles, permissions, settings) while preserving cross-tenant isolation boundaries.

This proposal also updates the Prisma seed script to create two tenant organizations (`OrgA` and `OrgB`) with standard tenant users in both the `nipp_dev` and `nipp_test` databases, providing consistent test fixtures for isolation testing.

## References & Foundational Rules
This proposal builds upon and must strictly adhere to the rules, design system, and infrastructure established in:

- **`project-initialization`**: Core architecture, tenant isolation strategy (Prisma Extension + RLS), BetterAuth setup, version pinning, and secrets management.
- **`basic-authentication-login-flow`**: Login flow, session management, cookie handling (dot and dash variants), logout mechanics, and cross-tab invalidation.
- **`auth-and-rbac`**: RBAC engine, permission catalog (`resource:action` syntax), Redis caching with 5-min TTL, Platform Organization security, session augmentation, `usePermission` hooks, `<RequirePermission>` component, and automatic role bootstrapping.
- **`super-admin-org-mgmt`**: Existing Super Admin dashboard, global DB client (`lib/global-db.ts`), `requireSuperAdmin()` guards, `<RequireSuperAdmin>` component.

**Mandatory Rules Enforced:**
- **Unified Architecture:** Single Next.js origin. No separate backend servers.
- **Version Pinning:** Node.js 22 LTS, Next.js 15, React 19, Vitest 4.x.
- **Database & ORM:** PostgreSQL only, Prisma ORM.
- **Tenant Isolation:** `organizationId` is mandatory on all organization-scoped models. The defense-in-depth strategy (Prisma Extension + RLS) must not be bypassed except through explicitly guarded Super Admin pathways.
- **Secrets Management:** No real secrets committed to GitHub. Use `.env.example` for new variables.
- **Test-Driven Completeness:** No code is considered "done" without passing tests. Every new library function, API route, and UI component must have corresponding unit tests. Integration tests must verify end-to-end flows.
- **Strict Property NI Design System Compliance:** ALL UI components MUST use the Property NI color palette. Navy (`#1B2A4A`) for primary elements. Amber (`#F5A623`) for accents, CTAs, and highlights. NO exceptions.
- **Import Path & Casing Consistency:** All imports MUST use correct PascalCase for component names. Import paths MUST use `@/` alias and match exact file casing.
- **Edge vs. Node Runtime Boundaries:** Middleware MUST NOT import Prisma or ioredis directly. Use cookie-only validation in middleware. Server components and API routes MUST lazy-load Node.js dependencies when called from Edge Runtime contexts.
- **Strict Platform Organization Gating:** All `/admin/*` pages, components, and API routes MUST be restricted exclusively to members of the Platform (Super Admin) Organization.

## Non-Regression Requirements
This proposal MUST NOT break any functionality established in previous proposals:
- **Auth:** Cookie clearing, database session invalidation, full page reload on logout, cross-tab session invalidation.
- **AuthZ:** Permission resolution with Redis caching, session augmentation, automatic role bootstrapping, Platform Organization security guard.
- **Project:** Prisma Extension tenant isolation, additive/non-destructive migrations.
- **Super Admin Org Mgmt:** Existing `/admin/organizations` list view, existing admin API routes must continue to function.

## Scope

**In Scope:**
1. **Super Admin Tenant Management API Endpoints** — New endpoints under `/api/admin/organizations/[orgId]/...` for Super Admins to view and modify any tenant org data:
   - `GET /api/admin/organizations/[orgId]/members` — List all members of a tenant org
   - `POST /api/admin/organizations/[orgId]/members` — Add a member to a tenant org
   - `PATCH /api/admin/organizations/[orgId]/members/[memberId]` — Update member role
   - `DELETE /api/admin/organizations/[orgId]/members/[memberId]` — Remove a member
   - `GET /api/admin/organizations/[orgId]/roles` — List all roles in a tenant org
   - `POST /api/admin/organizations/[orgId]/roles` — Create a role in a tenant org
   - `PATCH /api/admin/organizations/[orgId]/roles/[roleId]` — Update a role
   - `DELETE /api/admin/organizations/[orgId]/roles/[roleId]` — Delete a role
   - `GET /api/admin/organizations/[orgId]/permissions` — List all permissions in a tenant org
   - `PATCH /api/admin/organizations/[orgId]/permissions` — Assign/revoke permissions to roles
   - `PATCH /api/admin/organizations/[orgId]/settings` — Update org settings (name, slug, status)
2. **Super Admin Tenant Management UI** — Pages under `/admin/organizations/[orgId]/...` with forms on top of the above endpoints:
   - `/admin/organizations/[orgId]/members` — Member list with add/edit/remove forms
   - `/admin/organizations/[orgId]/roles` — Role list with create/edit/delete forms
   - `/admin/organizations/[orgId]/permissions` — Permission assignment UI
   - `/admin/organizations/[orgId]/settings` — Org settings form (name, slug, status toggle)
3. **Updated Prisma Seed Script** — Create `OrgA` and `OrgB` tenant organizations with standard tenant users in both `nipp_dev` and `nipp_test` databases:
   - OrgA: "Acme Properties Ltd" with tenant user `orga-tenant@example.com`
   - OrgB: "Belfast Rentals" with tenant user `orgb-tenant@example.com`
   - Each org has default roles (member, property-manager, viewer) with appropriate permissions
4. **Super Admin Context for Tenant Operations** — When a Super Admin operates on a tenant org, the request must:
   - Be authenticated as a Super Admin (Platform Organization member)
   - Use `globalDb` for cross-org queries and tenant-scoped `tenantDb` within a `runWithTenant(orgId, ...)` context for operations on that specific org's data
   - Log all actions to the audit log

**Out of Scope (Deferred):**
- User impersonation ("Log in as" feature for Super Admins).
- Bulk operations UI (bulk member add/remove, bulk role assignment).
- Tenant org data export/import.
- Tenant-specific feature configuration (beyond basic settings like name, slug, status).

## Files to Create or Modify

| Type | File Path | Purpose |
|------|-----------|---------|
| Modified | `prisma/seed.ts` | Add OrgA and OrgB with tenant users for dev and test databases |
| New | `app/api/admin/organizations/[orgId]/members/route.ts` | List/add members API |
| New | `app/api/admin/organizations/[orgId]/members/[memberId]/route.ts` | Update/remove member API |
| New | `app/api/admin/organizations/[orgId]/roles/route.ts` | List/create roles API |
| New | `app/api/admin/organizations/[orgId]/roles/[roleId]/route.ts` | Update/delete role API |
| New | `app/api/admin/organizations/[orgId]/permissions/route.ts` | List/assign permissions API |
| New | `app/api/admin/organizations/[orgId]/settings/route.ts` | Update org settings API |
| New | `app/admin/organizations/[orgId]/members/page.tsx` | Member management UI |
| New | `app/admin/organizations/[orgId]/roles/page.tsx` | Role management UI |
| New | `app/admin/organizations/[orgId]/permissions/page.tsx` | Permission assignment UI |
| New | `app/admin/organizations/[orgId]/settings/page.tsx` | Org settings UI |
| New | `components/admin/TenantMemberForm.tsx` | Member add/edit form component |
| New | `components/admin/TenantRoleForm.tsx` | Role add/edit form component |
| New | `components/admin/TenantPermissionAssign.tsx` | Permission assignment component |

## Testing Plan

- **Unit tests** for each new API route handler (mock Prisma, verify auth guard, verify request/response shapes)
- **Unit tests** for each new UI form component (render with props, verify submit behavior)
- **Integration tests** for the full flow: Super Admin logs in → navigates to tenant org → modifies member/role/permission → verifies change persisted
- **Isolation tests** (covered in separate proposal): Verify cross-tenant isolation, super admin exclusivity
- **Manual testing**: Super Admin logs in → visits `/admin/organizations/[orgId]/members` → adds member → verifies member appears
- **Security testing**: Verify that a non-Super Admin user gets 403 on all new endpoints

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Super admin accidentally modifies critical tenant data | High | Audit logging on all mutations, confirmation dialogs in UI |
| Tenant isolation bypass via globalDb misuse | Critical | Strict code review, runtime guard on `getGlobalDb()`, tests verify isolation |
| Scope creep — adding too many endpoints | Medium | Stick to the defined endpoint list; defer bulk operations and export features |
| Breaking existing admin routes | High | Non-regression tests verify existing `/admin/organizations` list view still works |

## Acceptance Criteria

- [ ] Super Admin can list all members of any tenant organization via API and UI
- [ ] Super Admin can add a new member to any tenant organization
- [ ] Super Admin can update a member's role in any tenant organization
- [ ] Super Admin can remove a member from any tenant organization
- [ ] Super Admin can list all roles in any tenant organization
- [ ] Super Admin can create, update, and delete roles in any tenant organization
- [ ] Super Admin can assign/revoke permissions to roles in any tenant organization
- [ ] Super Admin can update org settings (name, slug, status) for any tenant organization
- [ ] All new endpoints are guarded by `requireSuperAdmin()` — non-Super Admins receive 403
- [ ] All new UI pages are wrapped in `<RequireSuperAdmin>` — non-Super Admins see AccessDenied
- [ ] Prisma seed creates OrgA and OrgB with tenant users in both dev and test databases
- [ ] All new API routes have unit tests
- [ ] All new UI components have unit tests
