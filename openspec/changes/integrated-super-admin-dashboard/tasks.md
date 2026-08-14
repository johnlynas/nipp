# Tasks

## 0. Pre-Implementation Verification
- [ ] 0.1 Verify all existing service layer files are importable (`services/organization-service.ts`, `services/team-service.ts`, etc.)
- [ ] 0.2 Verify `lib/api-client.ts` exists and has consistent fetch wrapper
- [ ] 0.3 Verify `@tanstack/react-query` is configured in `app/providers.tsx`
- [ ] 0.4 Verify Property NI colors are defined in `app/globals.css` `@theme` block
- [ ] 0.5 Verify `lucide-react` is installed (check `package.json`)
- [ ] 0.6 Verify existing `/admin/*` dashboard routes still compile (`npm run type-check`)

## 1. Dashboard Shell & Layout
- [ ] 1.1 Create `app/dashboard/admin/layout.tsx` with collapsible navy sidebar and light content area
- [ ] 1.2 Implement sidebar state (`sidebarOpen: boolean`) with CSS transition for slide-in/out
- [ ] 1.3 Add sidebar nav items: Users, Organizations, Teams, Roles, Permissions (with lucide-react icons)
- [ ] 1.4 Add top bar with page title and user avatar placeholder
- [ ] 1.5 Wrap layout content in `<RequireSuperAdmin>` guard
- [ ] 1.6 **VERIFY:** Sidebar uses `bg-[#1B2A4A]` (Navy), active item has Amber accent
- [ ] 1.7 **VERIFY:** Content area uses `bg-[#f8f9fa]` (light background)
- [ ] 1.8 **TEST:** Write unit test for layout component (sidebar toggle, super admin guard)

## 2. Shared UI Components
- [ ] 2.1 Create `components/dashboard/DataTable.tsx` — reusable table with headers, rows, loading state, empty state
- [ ] 2.2 Create `components/dashboard/StatCard.tsx` — metric card with label, value, icon, color
- [ ] 2.3 Create `components/dashboard/SearchBar.tsx` — input with search icon, debounced
- [ ] 2.4 Create `components/dashboard/StatusBadge.tsx` — color-coded status pill (Active, Pending, Banned, etc.)
- [ ] 2.5 Create `components/dashboard/ConfirmDialog.tsx` — confirmation modal with title, message, confirm/cancel buttons
- [ ] 2.6 Create `components/dashboard/Modal.tsx` — generic modal with overlay, close on backdrop click, Escape key
- [ ] 2.7 Create `components/dashboard/MultiSelect.tsx` — searchable multi-select dropdown for relationship management
- [ ] 2.8 Create `components/dashboard/PageHeader.tsx` — panel title + description + action button row
- [ ] 2.9 **VERIFY:** All icon-only buttons include `aria-label` attributes
- [ ] 2.10 **TEST:** Write unit tests for each shared component (render, interactions)

## 3. Organizations Panel
- [ ] 3.1 Create `app/dashboard/admin/organizations/page.tsx` — list view with stat cards, search, table
- [ ] 3.2 Wire to `GET /api/dashboard/admin/organizations` API route
- [ ] 3.3 Implement stat cards: Total Orgs, Active, Suspended, Archived
- [ ] 3.4 Implement search by organization name/slug
- [ ] 3.5 Implement status filter dropdown (All, Active, Pending, Suspended, Archived)
- [ ] 3.6 Implement table columns: Name, Slug, Status, Members, Teams, Created Date, Actions
- [ ] 3.7 Create `components/dashboard/OrgDetailModal.tsx` — modal showing org details, members list, teams list
- [ ] 3.8 Create `components/dashboard/OrgForm.tsx` — create/edit form with name, slug (auto-generated), status
- [ ] 3.9 Implement "Create Organization" button → opens form modal
- [ ] 3.10 Implement action buttons: View (opens detail modal), Edit (opens form modal), Archive
- [ ] 3.11 **VERIFY:** All API calls use `OrganizationService` from service layer
- [ ] 3.12 **TEST:** Write integration test: Create org → List orgs → Update org → Archive org

## 4. Users Panel
- [ ] 4.1 Create `app/dashboard/admin/users/page.tsx` — list view with stat cards, search, table
- [ ] 4.2 Wire to `GET /api/dashboard/admin/users` API route
- [ ] 4.3 Implement stat cards: Total Users, Online Now, Banned, Email Verified
- [ ] 4.4 Implement search by name or email
- [ ] 4.5 Implement filter dropdown: All, Verified, Unverified, Banned
- [ ] 4.6 Implement table columns: User (avatar + name + email), Role, Status, Last Active, Joined, Actions
- [ ] 4.7 Create `components/dashboard/UserDetailModal.tsx` — modal showing user details, assigned roles, org memberships
- [ ] 4.8 Create `components/dashboard/UserForm.tsx` — create/edit form with name, email, role assignment
- [ ] 4.9 Implement "Add User" button → opens form modal
- [ ] 4.10 Implement ban/unban action (toggle) with `ConfirmDialog`
- [ ] 4.11 Implement role assignment in user detail modal (multi-select)
- [ ] 4.12 **VERIFY:** All API calls use `UserService` from service layer
- [ ] 4.13 **TEST:** Write integration test: Create user → List users → Ban user → Unban user

## 5. Teams Panel
- [ ] 5.1 Create `app/dashboard/admin/teams/page.tsx` — list view with stat cards, search, table
- [ ] 5.2 Wire to `GET /api/dashboard/admin/teams` API route
- [ ] 5.3 Implement stat cards: Total Teams, Total Members Across Teams, Teams With Roles Assigned
- [ ] 5.4 Implement organization filter dropdown (select which org's teams to view)
- [ ] 5.5 Implement search by team name
- [ ] 5.6 Implement table columns: Team Name, Organization, Members Count, Roles Assigned, Created Date, Actions
- [ ] 5.7 Create `components/dashboard/TeamDetailModal.tsx` — modal showing team details, members list, assigned roles
- [ ] 5.8 Create `components/dashboard/TeamForm.tsx` — create/edit form with name, slug (auto-generated), description
- [ ] 5.9 Implement "Create Team" button → opens form modal (requires org selection)
- [ ] 5.10 Implement add/remove team members (multi-select with search)
- [ ] 5.11 Implement assign/revoke default roles to team (multi-select with search)
- [ ] 5.12 **VERIFY:** All API calls use `TeamService` from service layer
- [ ] 5.13 **TEST:** Write integration test: Create team → Add member → Assign role → Remove member

## 6. Roles Panel
- [ ] 6.1 Create `app/dashboard/admin/roles/page.tsx` — list view with stat cards, search, table
- [ ] 6.2 Wire to `GET /api/dashboard/admin/roles` API route
- [ ] 6.3 Implement stat cards: Total Roles, Default Roles, Custom Roles, Roles With Permissions
- [ ] 6.4 Implement organization filter dropdown (select which org's roles to view)
- [ ] 6.5 Implement search by role name
- [ ] 6.6 Implement filter dropdown: All, Default, Custom
- [ ] 6.7 Implement table columns: Role Name, Organization, Type (Default/Custom), Permissions Count, Members Count, Actions
- [ ] 6.8 Create `components/dashboard/RoleDetailModal.tsx` — modal showing role details, assigned permissions, members
- [ ] 6.9 Create `components/dashboard/RoleForm.tsx` — create/edit form with name, description
- [ ] 6.10 Implement "Create Role" button → opens form modal (requires org selection)
- [ ] 6.11 Implement permission assignment in role detail modal (multi-select with search, shows resource:action)
- [ ] 6.12 Implement safety check on delete (warn if members or permissions assigned)
- [ ] 6.13 **VERIFY:** All API calls use `RoleService` from service layer
- [ ] 6.14 **VERIFY:** Redis cache invalidation triggered on role update/delete
- [ ] 6.15 **TEST:** Write integration test: Create role → Assign permissions → View members → Delete role (with safety check)

## 7. Permissions Panel
- [ ] 7.1 Create `app/dashboard/admin/permissions/page.tsx` — list view with stat cards, search, table
- [ ] 7.2 Wire to `GET /api/dashboard/admin/permissions` API route
- [ ] 7.3 Implement stat cards: Total Permissions, Unique Resources, Roles Using Each Permission (avg)
- [ ] 7.4 Implement search by permission key, resource, or action
- [ ] 7.5 Implement filter dropdown: All, by Resource (dropdown of unique resources)
- [ ] 7.6 Implement table columns: Permission Key, Resource, Action, Description, Roles Using It, Actions
- [ ] 7.7 Create `components/dashboard/PermissionForm.tsx` — create/edit form with key (resource:action), resource, action, description
- [ ] 7.8 Implement "Create Permission" button → opens form modal
- [ ] 7.9 Implement view roles using permission (read-only, shown in table)
- [ ] 7.10 Implement safety check on delete (warn if assigned to any role)
- [ ] 7.11 **VERIFY:** All API calls use `PermissionService` from service layer
- [ ] 7.12 **VERIFY:** Redis cache invalidation triggered on permission update/delete
- [ ] 7.13 **TEST:** Write integration test: Create permission → Assign to role → Delete permission (with safety check)

## 8. Super Admin Gating Implementation
- [ ] 8.1 **VERIFY:** `lib/require-super-admin.ts` exists and uses `verifySuperAdmin()` from `lib/authz.ts`
- [ ] 8.2 **VERIFY:** `components/auth/RequireSuperAdmin.tsx` exists and uses `useIsSuperAdmin()` hook
- [ ] 8.3 **VERIFY:** `components/admin/AccessDenied.tsx` exists as fallback UI for unauthorized users
- [ ] 8.4 Create `app/dashboard/admin/layout.tsx` — wrap all children in `<RequireSuperAdmin>` (same pattern as `app/admin/layout.tsx`)
- [ ] 8.5 **VERIFY:** Layout uses `useIsSuperAdmin()` to gate sidebar visibility (sidebar only renders for Super Admin users)
- [ ] 8.6 **TEST:** Write unit test: Render `<RequireSuperAdmin>` with non-Super-Admin user → expect `<AccessDenied />`
- [ ] 8.7 **TEST:** Write unit test: Render `<RequireSuperAdmin>` with Super Admin user → expect children rendered
- [ ] 8.8 **TEST:** Write unit test: Call any `/api/dashboard/admin/*` endpoint as non-Super-Admin → expect 403 Forbidden

## 9. API Routes — Core Infrastructure
- [ ] 9.1 Create `app/api/dashboard/admin/route.ts` — stats endpoint (aggregate counts across all models)
- [ ] 9.2 Create `app/api/dashboard/admin/organizations/route.ts` — GET (list with pagination), POST (create)
- [ ] 9.3 Create `app/api/dashboard/admin/organizations/[id]/route.ts` — GET (detail), PATCH (update)
- [ ] 9.4 Create `app/api/dashboard/admin/organizations/[id]/status/route.ts` — PATCH (state transition)
- [ ] 9.5 **VERIFY:** All routes include `export const runtime = 'nodejs'`
- [ ] 9.6 **VERIFY:** All routes import `globalDb` where cross-org access is needed
- [ ] 9.7 **VERIFY:** All routes call `requireSuperAdmin()` at the top (before any business logic)
- [ ] 9.8 **TEST:** Write unit tests for all organization API routes (mock service layer)
- [ ] 9.9 **TEST:** Write integration test: Non-Super-Admin calls `GET /api/dashboard/admin/organizations` → expect 403

## 10. API Routes — Users, Teams, Roles, Permissions
- [ ] 10.1 Create `app/api/dashboard/admin/users/route.ts` — GET (list), POST (create)
- [ ] 10.2 Create `app/api/dashboard/admin/users/[id]/route.ts` — GET (detail), PATCH (update), DELETE
- [ ] 10.3 Create `app/api/dashboard/admin/users/[id]/ban/route.ts` — POST (toggle ban)
- [ ] 10.4 Create `app/api/dashboard/admin/teams/route.ts` — GET (list by org), POST (create)
- [ ] 10.5 Create `app/api/dashboard/admin/teams/[id]/route.ts` — GET (detail), PATCH (update), DELETE
- [ ] 10.6 Create `app/api/dashboard/admin/teams/[id]/members/route.ts` — GET, POST (add), DELETE (remove)
- [ ] 10.7 Create `app/api/dashboard/admin/teams/[id]/roles/route.ts` — GET, POST (assign), DELETE (revoke)
- [ ] 10.8 Create `app/api/dashboard/admin/roles/route.ts` — GET (list by org), POST (create)
- [ ] 10.9 Create `app/api/dashboard/admin/roles/[id]/route.ts` — GET (detail), PATCH (update), DELETE
- [ ] 10.10 Create `app/api/dashboard/admin/roles/[id]/permissions/route.ts` — GET, POST (assign), DELETE (revoke)
- [ ] 10.11 Create `app/api/dashboard/admin/roles/[id]/members/route.ts` — GET (list assigned members)
- [ ] 10.12 Create `app/api/dashboard/admin/permissions/route.ts` — GET (list catalog), POST (create)
- [ ] 10.13 **VERIFY:** All routes include `export const runtime = 'nodejs'`
- [ ] 10.14 **VERIFY:** All routes call `requireSuperAdmin()` at the top (before any business logic)
- [ ] 10.15 **VERIFY:** All routes delegate to service layer (no direct Prisma calls)
- [ ] 10.16 **TEST:** Write unit tests for all user, team, role, and permission API routes
- [ ] 10.17 **TEST:** Write integration test: Non-Super-Admin calls any `/api/dashboard/admin/*` endpoint → expect 403

## 11. Integration & Polish
- [ ] 11.1 Add loading states to all panels (skeleton or spinner)
- [ ] 11.2 Add error handling with toast notifications (using `sonner`, already installed)
- [ ] 11.3 Add pagination to all list views (consistent with existing admin dashboard)
- [ ] 11.4 Add responsive design — sidebar collapses on mobile, tables scroll horizontally
- [ ] 11.5 Add keyboard navigation — Escape to close modals, Enter to activate buttons
- [ ] 11.6 Run `npm run type-check` — ensure zero TypeScript errors
- [ ] 11.7 Run `npm run lint` — ensure zero ESLint errors
- [ ] 11.8 Run `npm test` — ensure all existing tests still pass (non-regression)
- [ ] 11.9 Run `npm run test:all` — ensure new tests pass

## 12. Documentation
- [ ] 12.1 Update `README.md` with new dashboard route (`/dashboard/admin`)
- [ ] 12.2 Create `documents/feature-planning-and-development/integrated-super-admin-dashboard.md` with API reference
- [ ] 12.3 Document the relationship management UI patterns (User↔Roles, Role↔Permissions, Team→Users, Team→Roles)
