# Super Admin Dashboard — Service Layer UI Migration: Tasks

## Phase 0: Organizations Page Upgrade

### Task 0.1 — Add Lucide Icon Action Buttons to Organizations Table
- [ ] Replace text "View" link with `<Eye />` icon button (opens View modal instead of navigating to separate page)
- [ ] Add `<Pencil />` icon button for Edit (opens inline edit modal)
- [ ] Replace ConfirmDialog delete trigger with `<Trash2 />` icon button (triggers ConfirmDialog on click)
- [ ] Import `Eye`, `Pencil`, `Trash2` from `lucide-react`
- [ ] Style buttons consistently with other admin pages (small icons, hover states)

### Task 0.2 — Add Inline Edit Modal for Organizations
- [ ] Create an edit modal (reusing `EditModal` component from Phase 2) for organizations
- [ ] Form fields: name, slug (optional), status dropdown (PENDING/ACTIVE/SUSPENDED/ARCHIVED)
- [ ] Submit calls PATCH `/api/admin/organizations/[id]` (or existing endpoint) via `OrganizationService`
- [ ] On success: close modal, re-fetch table data
- [ ] Remove the separate `/admin/organizations/[orgId]` page if no longer needed (or keep as View-only)

## Phase 1: API Route Foundation

### Task 1.1 — Migrate Permissions API to PermissionService
- [ ] Replace direct `globalDb.permission` calls in `app/api/admin/permissions/route.ts` with `PermissionService.list()`, `PermissionService.create()`
- [ ] Add PATCH endpoint at `app/api/admin/permissions/[id]/route.ts` using `PermissionService.update()`
- [ ] Add DELETE endpoint at `app/api/admin/permissions/[id]/route.ts` using `PermissionService.delete()`
- [ ] Ensure all endpoints use `wrapPiiRoute()`, `requireSuperAdmin()`, and `recordAuditLog()`
- [ ] Verify response shapes match existing frontend expectations

### Task 1.2 — Create Roles API Route
- [ ] Create `app/api/admin/roles/route.ts` with GET (list) and POST (create) using `RoleService`
- [ ] Create `app/api/admin/roles/[roleId]/route.ts` with GET (by id), PATCH (update), DELETE
- [ ] Use `env.PLATFORM_ORGANIZATION_ID` as the default `targetOrgId` for Super Admin operations
- [ ] Add `wrapPiiRoute()`, `requireSuperAdmin()`, and `recordAuditLog()` to all endpoints
- [ ] Set `dynamic = 'force-dynamic'` and `revalidate = 0`

### Task 1.3 — Create Users API Route
- [ ] Create `app/api/admin/users/route.ts` with GET (list) and POST (create) using `UserService`
- [ ] Create `app/api/admin/users/[userId]/route.ts` with GET (by id), PATCH (update), DELETE
- [ ] Pass `role: 'PLATFORM_ADMIN'` in ServiceContext for Super Admin operations
- [ ] Add `wrapPiiRoute()`, `requireSuperAdmin()`, and `recordAuditLog()` to all endpoints
- [ ] Set `dynamic = 'force-dynamic'` and `revalidate = 0`

## Phase 2: Shared UI Components

### Task 2.1 — Create EditModal Component
- [ ] Create `components/admin/EditModal.tsx` — reusable modal wrapper with title, close button, and form slot
- [ ] Accept `isOpen`, `onClose`, `title`, and `children` (form content) as props
- [ ] Use consistent styling: backdrop overlay, centered modal, close on backdrop click

### Task 2.2 — Create ConfirmDialog Component (if not already shared)
- [ ] Verify `components/admin/ConfirmDialog.tsx` exists (already imported by Org page)
- [ ] If missing, create it with `isOpen`, `onConfirm`, `onCancel`, `title`, and `message` props
- [ ] Use consistent styling matching the Org page's confirm dialog

## Phase 3: Permissions Admin Page Rebuild

### Task 3.1 — Rebuild Permissions Table
- [ ] Replace inline form + flat table in `app/admin/permissions/page.tsx` with paginated table
- [ ] Add debounced search input (200ms debounce, same as Org page)
- [ ] Add dropdown filter for resource type (Organization, Role, Permission, etc.)
- [ ] Implement pagination state with page/pageSize/total totalPages
- [ ] Fetch data from `/api/admin/permissions` using `encryptedFetch`

### Task 3.2 — Add Per-Row Action Buttons
- [ ] Add View (`<Eye />`), Edit (`<Pencil />`), Delete (`<Trash2 />`) buttons to each row
- [ ] View: opens modal showing permission details (read-only)
- [ ] Edit: opens EditModal with pre-filled form for that permission
- [ ] Delete: triggers ConfirmDialog, then calls DELETE `/api/admin/permissions/[id]`

### Task 3.3 — Add Create/Edit Forms
- [ ] "+ Add Permission" button opens EditModal with empty form
- [ ] Form fields: key (resource:action), resource, action, description
- [ ] Submit calls POST `/api/admin/permissions` (create) or PATCH `/api/admin/permissions/[id]` (update)
- [ ] On success: close modal, re-fetch table data

## Phase 4: Roles Admin Page (New)

### Task 4.1 — Create Roles Table Page
- [ ] Create `app/admin/roles/page.tsx` with paginated table layout matching Org template
- [ ] Add debounced search input and dropdown filter (e.g., default/non-default)
- [ ] Fetch data from `/api/admin/roles` using `encryptedFetch`
- [ ] Columns: Name, Description, Is Default badge, Member Count, Actions

### Task 4.2 — Add Per-Row Action Buttons
- [ ] Add View (`<Eye />`), Edit (`<Pencil />`), Delete (`<Trash2 />`) buttons to each row
- [ ] View: opens modal showing role details (read-only, including assigned permissions)
- [ ] Edit: opens EditModal with pre-filled form for that role
- [ ] Delete: triggers ConfirmDialog, then calls DELETE `/api/admin/roles/[roleId]`

### Task 4.3 — Add Create/Edit Forms
- [ ] "+ Add Role" button opens EditModal with empty form
- [ ] Form fields: name, description (optional), isDefault checkbox
- [ ] Submit calls POST `/api/admin/roles` or PATCH `/api/admin/roles/[roleId]`
- [ ] On success: close modal, re-fetch table data

## Phase 5: Users Admin Page (New)

### Task 5.1 — Create Users Table Page
- [ ] Create `app/admin/users/page.tsx` with paginated table layout matching Org template
- [ ] Add debounced search input and dropdown filter (e.g., by role: member/admin)
- [ ] Fetch data from `/api/admin/users` using `encryptedFetch`
- [ ] Columns: Name, Email, Role(s), Member Count, Created At, Actions

### Task 5.2 — Add Per-Row Action Buttons
- [ ] Add View (`<Eye />`), Edit (`<Pencil />`), Delete (`<Trash2 />`) buttons to each row
- [ ] View: opens modal showing user details (read-only)
- [ ] Edit: opens EditModal with pre-filled form for that user
- [ ] Delete: triggers ConfirmDialog, then calls DELETE `/api/admin/users/[userId]`

### Task 5.3 — Add Create/Edit Forms
- [ ] "+ Add User" button opens EditModal with empty form
- [ ] Form fields: name, email (required), password (optional for create)
- [ ] Submit calls POST `/api/admin/users` or PATCH `/api/admin/users/[userId]`
- [ ] On success: close modal, re-fetch table data

## Phase 6: Navigation & Polish

### Task 6.1 — Update Admin Sidebar
- [ ] Add "Roles" and "Users" links to `app/admin/layout.tsx` navLinks array
- [ ] Position: after Organizations, before Permissions (logical grouping)
- [ ] Ensure active-state highlighting works with `usePathname`

### Task 6.2 — Consistency Pass
- [ ] Verify all four pages use the same header styling (`h1`/`h2`, subtitle text)
- [ ] Verify all tables use consistent column headers, row hover states, and border styles
- [ ] Verify all modals/dialogs use consistent sizing and backdrop styling
- [ ] Verify error display banners match across all pages

## Phase 7: Testing & Verification

### Task 7.1 — API Route Tests
- [ ] Test each CRUD endpoint with Super Admin auth (expect 200/201)
- [ ] Test each CRUD endpoint without Super Admin auth (expect 403)
- [ ] Test validation errors (missing required fields → 400)
- [ ] Test conflict scenarios (duplicate key/name → 409)
- [ ] Test not-found scenarios (invalid ID → 404)

### Task 7.2 — Manual UI Testing
- [ ] Verify all four admin pages load without errors
- [ ] Test pagination (next/prev, page size changes)
- [ ] Test search debounce and filter dropdown on each page
- [ ] Test create flow: open modal → fill form → submit → verify row appears
- [ ] Test edit flow: click Edit → modify fields → save → verify update
- [ ] Test delete flow: click Delete → confirm → verify row removed
- [ ] Test View modal on each page

### Task 7.3 — Security Verification
- [ ] Confirm non-Super Admin users cannot access any admin page (redirected or 403)
- [ ] Confirm audit logs are recorded for all create/update/delete actions
