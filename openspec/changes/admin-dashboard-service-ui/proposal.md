# Super Admin Dashboard — Service Layer UI Migration

**Status:** Proposed  
**Author:** Property NI Development Team  
**Created:** 2026-08-06  
**Last Updated:** 2026-08-06  
**Related Issues:** Service layer adoption, Admin UX consistency

---

## Summary

This proposal outlines the migration of all Super Admin dashboard pages to a consistent, paginated table UI pattern — using the existing Organizations page as the template. It also ensures every admin API route delegates to its corresponding service layer (`PermissionService`, `RoleService`, `UserService`) rather than calling Prisma directly. The result is a uniform, maintainable admin experience with full CRUD operations (View, Edit, Delete) across all four data models.

## Motivation

### Current State
The Super Admin dashboard has four management pages, but they are inconsistent in both UX and architecture:

- **Organizations** — The template for pagination, search, and filtering; however it currently uses a text "View" link (navigates to a separate page) and a ConfirmDialog for delete, with no Edit functionality or Lucide icon buttons.
- **Permissions** — A raw inline form + flat table with no pagination, search, or filtering. The API route calls `globalDb.permission` directly, bypassing `PermissionService`.
- **Roles** — No admin page or API route exists at all, despite `RoleService` being fully implemented.
- **Users** — No admin page or API route exists at all, despite `UserService` being fully implemented.

### Problems This Solves
1. **Inconsistent UX** — Super Admin users encounter four different interaction patterns across the dashboard, increasing cognitive load and training time.
2. **Service layer bypass** — Permissions API route directly queries Prisma, missing out on `PermissionService`'s validation, error types (`NotFoundError`, `ConflictError`), audit logging, and cache invalidation.
3. **Missing functionality** — Roles and Users have service implementations but no admin UI or API routes, leaving these capabilities inaccessible to Super Admins.
4. **No action buttons** — The Organizations page uses a text "View" link (navigates away) and a ConfirmDialog for delete; no Edit functionality or Lucide icon buttons on any table.

### Benefits
- **Uniform experience** — All four pages share the same layout, pagination, search, and action patterns.
- **Service layer integrity** — Every API route goes through its service, ensuring consistent validation, error handling, and audit logging.
- **Full CRUD** — Super Admins can create, view, edit, and delete records for all four models directly from the dashboard.

## Scope

**In scope:**
- Upgrade Organizations admin page to use Lucide icon action buttons (`<Eye />`, `<Pencil />`, `<Trash2 />`) replacing the current text "View" link and ConfirmDialog delete flow; add inline edit modal for editing organizations
- Rebuild Permissions admin page to match Organizations UI pattern (paginated table, search, dropdown filter)
- Create Roles admin page matching the Organizations UI pattern (paginated table, search, dropdown filter)
- Create Users admin page matching the Organizations UI pattern (paginated table, search, dropdown filter)
- Migrate Permissions API route to use `PermissionService` (add PATCH/DELETE endpoints, replace direct Prisma calls)
- Create Roles API route using `RoleService` (GET/POST/PATCH/DELETE)
- Create Users API route using `UserService` (GET/POST/PATCH/DELETE)
- Add per-row action buttons (View, Edit, Delete with Lucide icons) to all four tables
- Add inline edit forms (modal or expandable row) for View/Edit operations

**Out of scope:**
- Audit Logs page redesign (separate concern)
- Cache Metrics page redesign (operational, not data-model CRUD)
- System Health / System Logs pages (operational monitoring)
- Tenant Admin dashboard changes (this change is Super Admin only)
- Frontend client-side service abstraction (pages call API routes directly)

## Detailed Design Overview

### Architecture
```
Frontend Page (React Client Component)
  └── encryptedFetch → API Route (/api/admin/<model>)
        └── requireSuperAdmin() + ServiceMethod()
              └── globalDb / tenantDb (via service)
```

### Key Decisions
1. **Organizations as the template** — The Org page already has pagination, debounced search, status filtering, and uses `OrganizationService`. All other pages replicate this pattern. The Org page itself is upgraded to use Lucide icon action buttons and an inline edit modal, bringing it in line with the other three pages.
2. **Inline edit forms** — Instead of navigating to separate edit pages, each table row will have an "Edit" button that opens an inline form (either a modal or expandable row) for quick CRUD.
3. **Lucide icons** — Use `<Eye />`, `<Pencil />`, and `<Trash2 />` from `lucide-react` for View, Edit, Delete actions.
4. **Service layer enforcement** — Every API route must call its corresponding service method; no direct `globalDb` queries in admin routes.
5. **Super Admin only** — All four pages are wrapped in `<RequireSuperAdmin>` and all API routes call `requireSuperAdmin()`.

## Files to Create or Modify

### New Files
| Type | File Path | Purpose |
|------|-----------|---------|
| New | `app/api/admin/roles/route.ts` | Roles CRUD API route using `RoleService` |
| New | `app/api/admin/roles/[roleId]/route.ts` | Roles single-resource API route (PATCH/DELETE) |
| New | `app/api/admin/users/route.ts` | Users CRUD API route using `UserService` |
| New | `app/api/admin/users/[userId]/route.ts` | Users single-resource API route (PATCH/DELETE) |
| New | `app/admin/roles/page.tsx` | Roles admin page (paginated table + inline forms) |
| New | `app/admin/users/page.tsx` | Users admin page (paginated table + inline forms) |
| New | `components/admin/ConfirmDialog.tsx` | Reusable confirmation dialog for delete actions (if not already shared) |

### Modified Files
| Type | File Path | Purpose |
|------|-----------|---------|
| Modified | `app/admin/organizations/page.tsx` | Replace text "View" link and ConfirmDialog delete with Lucide icon buttons (`<Eye />`, `<Pencil />`, `<Trash2 />`); add inline edit modal |
| Modified | `app/api/admin/permissions/route.ts` | Replace direct Prisma calls with `PermissionService`; add PATCH/DELETE endpoints |
| Modified | `app/admin/permissions/page.tsx` | Rebuild UI to match Organizations pattern (pagination, search, dropdown, action buttons) |
| Modified | `app/admin/layout.tsx` | Add Roles and Users nav links to sidebar |

## Testing Plan
- **Unit tests** — Service layer methods are already tested; verify API routes correctly delegate to services.
- **Integration tests** — Test each admin API route with Super Admin auth, verifying CRUD operations and proper error responses (403 for non-super-admin, 404 for missing records, 409 for conflicts).
- **Manual testing** — Verify all four admin pages load correctly, pagination works, search debounces properly, dropdown filters apply, and inline edit/delete flows complete without errors.
- **Security testing** — Confirm non-Super Admin users receive 403 on all admin pages and API routes.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing permissions API consumers | High | The Permissions route already uses `wrapPiiRoute`; maintain the same response shape. Add deprecation header if external consumers exist. |
| RoleService `targetOrgId` complexity for Super Admin | Medium | Super Admin operations on Roles use the Platform org ID; document this in the API route. |
| UserService Tenant Admin scope filtering on Super Admin page | Medium | Super Admin context (`role: 'PLATFORM_ADMIN'`) bypasses Tenant Admin org-scoped filtering in `UserService.list()`. |
| Inline edit form state management complexity | Low | Use controlled React state with clear create/edit/delete handlers; keep forms simple. |

## Acceptance Criteria
- [ ] Organizations admin page uses Lucide icon action buttons (`<Eye />`, `<Pencil />`, `<Trash2 />`) on each row replacing the text "View" link and ConfirmDialog delete flow
- [ ] Organizations admin page includes an inline edit modal for editing organizations without page navigation
- [ ] Permissions admin page uses paginated table with search box, dropdown filter, and per-row View/Edit/Delete buttons
- [ ] Permissions API route uses `PermissionService` for all operations (no direct Prisma calls)
- [ ] Permissions API route supports GET, POST, PATCH, DELETE methods
- [ ] Roles admin page exists with paginated table, search box, dropdown filter, and per-row View/Edit/Delete buttons
- [ ] Roles API route exists with GET, POST, PATCH, DELETE methods using `RoleService`
- [ ] Users admin page exists with paginated table, search box, dropdown filter, and per-row View/Edit/Delete buttons
- [ ] Users API route exists with GET, POST, PATCH, DELETE methods using `UserService`
- [ ] All four admin pages are wrapped in `<RequireSuperAdmin>` and return 403 for non-Super Admin users
- [ ] Roles and Users nav links appear in the admin sidebar layout
- [ ] All action buttons use Lucide icons (`<Eye />`, `<Pencil />`, `<Trash2 />`)
- [ ] Inline edit forms allow creating and editing records without page navigation
