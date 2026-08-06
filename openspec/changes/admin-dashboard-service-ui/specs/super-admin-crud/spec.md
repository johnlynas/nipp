# Super Admin CRUD: Permissions, Roles, Users

## Requirements

### Requirement 1: Organizations Page — Lucide Icon Actions and Edit Modal
The Organizations admin page MUST use Lucide icon action buttons on each row and support inline editing, replacing the current text "View" link and ConfirmDialog delete flow.

#### Acceptance Criteria
- [ ] Each row in the Organizations table has View (`<Eye />`), Edit (`<Pencil />`), and Delete (`<Trash2 />`) icon buttons
- [ ] Clicking `<Eye />` opens a View modal showing organization details (read-only) instead of navigating to `/admin/organizations/[id]`
- [ ] Clicking `<Pencil />` opens an inline edit modal with pre-filled form (name, slug, status dropdown)
- [ ] Clicking `<Trash2 />` triggers the ConfirmDialog for archive/delete confirmation
- [ ] Edit form submits via `OrganizationService` (PATCH) and re-fetches the table on success
- [ ] Text "View" link is removed from the search results table (replaced with `<Eye />` button)
- [ ] ConfirmDialog delete trigger is replaced by the `<Trash2 />` icon button

### Requirement 3: Consistent Paginated Table UI
All Super Admin data model pages (Organizations, Permissions, Roles, Users) MUST present data in a consistent paginated table layout.

#### Acceptance Criteria
- [ ] Each page displays a paginated table with configurable page size (default 20)
- [ ] Each page includes a debounced search input (200ms debounce) for filtering by name/key
- [ ] Each page includes a dropdown filter (e.g., status, resource type, role)
- [ ] Filter changes reset pagination to page 1
- [ ] Table columns are clearly labeled with styled headers (dark background, uppercase text)
- [ ] Rows display a hover state for visual feedback

### Requirement 4: Permissions Admin Page
The Permissions admin page MUST provide full CRUD operations via a paginated table UI, using `PermissionService` for all data operations.

#### Acceptance Criteria
- [ ] GET `/api/admin/permissions` returns paginated permission list via `PermissionService.list()`
- [ ] POST `/api/admin/permissions` creates a permission via `PermissionService.create()` with validation
- [ ] PATCH `/api/admin/permissions/[id]` updates a permission via `PermissionService.update()`
- [ ] DELETE `/api/admin/permissions/[id]` deletes a permission via `PermissionService.delete()` with safety check
- [ ] Direct Prisma calls (`globalDb.permission`) are removed from the permissions API route
- [ ] Redis permission cache is invalidated on update and delete (handled by `PermissionService`)
- [ ] Each table row has View (`<Eye />`), Edit (`<Pencil />`), and Delete (`<Trash2 />`) action buttons
- [ ] Create form includes fields: key, resource, action, description
- [ ] Edit form pre-populates with existing permission data

### Requirement 5: Roles Admin Page
The Roles admin page MUST exist and provide full CRUD operations via a paginated table UI, using `RoleService` for all data operations.

#### Acceptance Criteria
- [ ] `app/admin/roles/page.tsx` exists and is accessible at `/admin/roles`
- [ ] GET `/api/admin/roles` returns paginated role list via `RoleService.list()`
- [ ] POST `/api/admin/roles` creates a role via `RoleService.create()` with validation
- [ ] PATCH `/api/admin/roles/[roleId]` updates a role via `RoleService.update()`
- [ ] DELETE `/api/admin/roles/[roleId]` deletes a role via `RoleService.delete()`
- [ ] Each table row has View (`<Eye />`), Edit (`<Pencil />`), and Delete (`<Trash2 />`) action buttons
- [ ] Create form includes fields: name, description (optional), isDefault checkbox
- [ ] Edit form pre-populates with existing role data
- [ ] Table displays: Name, Description, Is Default badge, Member Count, Actions

### Requirement 6: Users Admin Page
The Users admin page MUST exist and provide full CRUD operations via a paginated table UI, using `UserService` for all data operations.

#### Acceptance Criteria
- [ ] `app/admin/users/page.tsx` exists and is accessible at `/admin/users`
- [ ] GET `/api/admin/users` returns paginated user list via `UserService.list()` with Platform Admin context
- [ ] POST `/api/admin/users` creates a user via `UserService.create()` with validation
- [ ] PATCH `/api/admin/users/[userId]` updates a user via `UserService.update()`
- [ ] DELETE `/api/admin/users/[userId]` deletes a user via `UserService.delete()`
- [ ] Each table row has View (`<Eye />`), Edit (`<Pencil />`), and Delete (`<Trash2 />`) action buttons
- [ ] Create form includes fields: name, email (required), password (optional)
- [ ] Edit form pre-populates with existing user data
- [ ] Table displays: Name, Email, Role(s), Member Count, Created At, Actions

### Requirement 7: Super Admin Access Control
All four admin pages and their API routes MUST be restricted to Super Admin users only.

#### Acceptance Criteria
- [ ] All four pages are wrapped in `<RequireSuperAdmin>` component
- [ ] All API routes call `requireSuperAdmin()` before processing requests
- [ ] Non-Super Admin users receive 403 status on API routes
- [ ] Non-Super Admin users are redirected or shown access denied on pages

### Requirement 8: Admin Sidebar Navigation
The admin sidebar MUST include navigation links to all four management pages.

#### Acceptance Criteria
- [ ] `app/admin/layout.tsx` includes nav links for: Organizations, Permissions, Roles, Users
- [ ] Active page highlighting works correctly via `usePathname` comparison
- [ ] Roles and Users links are positioned logically (after Organizations, before Permissions)

### Requirement 9: Audit Logging
All create, update, and delete operations on Permissions, Roles, and Users MUST be recorded in the audit log.

#### Acceptance Criteria
- [ ] Every POST (create) calls `recordAuditLog()` with appropriate action, resourceType, and resourceId
- [ ] Every PATCH (update) calls `recordAuditLog()` with appropriate action, resourceType, and resourceId
- [ ] Every DELETE calls `recordAuditLog()` with appropriate action, resourceType, and resourceId
- [ ] Audit entries include the acting Super Admin's userId and userName

### Requirement 10: Error Handling
All API routes MUST return consistent, user-friendly error responses.

#### Acceptance Criteria
- [ ] `ValidationError` → 400 `{ error: message }`
- [ ] `NotFoundError` → 404 `{ error: message }`
- [ ] `ConflictError` → 409 `{ error: message }`
- [ ] `ForbiddenError` → 403 `{ error: message }`
- [ ] Unknown errors → 500 `{ error: "Internal server error" }`
- [ ] Frontend pages display errors in a styled alert banner above the table
