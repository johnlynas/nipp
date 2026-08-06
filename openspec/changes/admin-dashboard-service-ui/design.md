# Super Admin Dashboard — Service Layer UI Migration: Technical Design

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Admin Pages (Client Components)                             │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │ Organizations│ │ Permissions  │ │ Roles        │        │
│  │ (template)   │ │ (rebuild)    │ │ (new)        │        │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘        │
│         │                │                 │                │
│  ┌──────┴────────────────┴─────────────────┴───────┐        │
│  │ encryptedFetch → /api/admin/<model>             │        │
│  └────────────────────┬───────────────────────────┘        │
└───────────────────────┼───────────────────────────────────┘
                        │
┌───────────────────────▼───────────────────────────────────┐
│  API Routes (Node Runtime)                                 │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐      │
│  │ requireSuper │ │ wrapPiiRoute │ │ recordAudit  │      │
│  │ Admin()      │ │ ()           │ │ Log          │      │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘      │
│         │                │                 │              │
│  ┌──────┴────────────────┴─────────────────┴───────┐      │
│  │ Service Layer                                    │      │
│  │ OrganizationService │ PermissionService          │      │
│  │ RoleService         │ UserService                │      │
│  └─────────────────────┬───────────────────────────┘      │
└────────────────────────┼──────────────────────────────────┘
                         │
┌────────────────────────▼──────────────────────────────────┐
│  Data Layer                                                │
│  globalDb (PostgreSQL) — RLS context set per request       │
└───────────────────────────────────────────────────────────┘
```

## Technical Decisions

### Decision 1: Use Organizations Page as the UI Template

**Rationale:** The Organizations page (`app/admin/organizations/page.tsx`) is the most mature admin page. It has:
- Debounced search input (200ms debounce)
- Status dropdown filter with reset-to-page-1 behavior
- Paginated table with configurable page size
- `RequireSuperAdmin` wrapper
- Clean header with action button

All other pages replicate this structure, swapping only the data model, column definitions, and form fields. The Organizations page itself is upgraded in this change to replace its text "View" link and ConfirmDialog delete with Lucide icon buttons (`<Eye />`, `<Pencil />`, `<Trash2 />`) and an inline edit modal, bringing it in line with the other three pages.

### Decision 2: Inline Edit Forms (Modal Pattern)

**Rationale:** Instead of navigating to separate `/admin/permissions/create` or `/admin/permissions/[id]/edit` pages, we use a modal dialog for create and edit operations. This keeps users in context and matches the "keep it simple" requirement.

**Implementation:**
- A shared `EditModal` component (or per-page modal) with a form
- Form fields are derived from the service's input types (`CreatePermissionInput`, `UpdateRoleInput`, etc.)
- On submit, the form calls the API route's POST/PATCH endpoint
- On success, the modal closes and the table re-fetches

### Decision 3: Per-Row Action Buttons with Lucide Icons

**Rationale:** The user provided a reference image showing View (Eye), Edit (Pencil), Delete (Trash2) buttons. These use Lucide icons which are already available in the project.

**Implementation:**
```tsx
import { Eye, Pencil, Trash2 } from 'lucide-react';

// In table row:
<button onClick={() => handleView(record)} title="View">
  <Eye className="w-4 h-4" />
</button>
<button onClick={() => handleEdit(record)} title="Edit">
  <Pencil className="w-4 h-4" />
</button>
<button onClick={() => handleDelete(record.id)} title="Delete">
  <Trash2 className="w-4 h-4" />
</button>
```

### Decision 4: API Route Structure

**Pattern:** Each model follows the same API route structure:

```
/api/admin/<model>/route.ts          — GET (list), POST (create)
/api/admin/<model>/[id]/route.ts     — GET (by id), PATCH (update), DELETE
```

**Common middleware in every route:**
1. `wrapPiiRoute()` — handles payload encryption/decryption
2. `requireSuperAdmin(headers)` — enforces Super Admin access
3. Service method call — delegates to the appropriate service
4. `recordAuditLog()` — logs the action

### Decision 5: Service Context for Super Admin Operations

**RoleService consideration:** `RoleService` methods take an explicit `targetOrgId` parameter (never derived from `ctx.organizationId`) because a Platform Admin's context org is the Platform org, not the target organization. For Super Admin role management:
- `targetOrgId` = `env.PLATFORM_ORGANIZATION_ID` (global roles)
- OR allow Super Admin to select which org's roles to manage

**UserService consideration:** `UserService.list()` already handles the Platform Admin case — it returns all users when `ctx.role === 'PLATFORM_ADMIN'`, bypassing the Tenant Admin org-scoped filtering.

## Data Flow — Create Permission Example

```
1. User clicks "+ Add Permission" → modal opens
2. User fills form: key="org:view", resource="Organization", action="view"
3. User clicks "Save" → POST /api/admin/permissions
4. API route: wrapPiiRoute → requireSuperAdmin → PermissionService.create()
5. Service: validates fields → checks duplicate key → creates record
6. Service: invalidates Redis permission cache → returns created permission
7. API route: records audit log → returns 201 { permission }
8. Frontend: modal closes, table re-fetches, new row appears
```

## Data Flow — Delete Role Example

```
1. User clicks Trash2 icon on a role row → ConfirmDialog opens
2. User confirms deletion
3. Frontend: DELETE /api/admin/roles/[roleId]
4. API route: wrapPiiRoute → requireSuperAdmin → RoleService.delete()
5. Service: verifies role exists → checks no members assigned → deletes record
6. API route: records audit log → returns 204
7. Frontend: table re-fetches, row removed
```

## Error Handling Strategy

All API routes follow the same error handling pattern:

| Service Error | HTTP Response |
|--------------|---------------|
| `ValidationError` | 400 `{ error: message }` |
| `NotFoundError` | 404 `{ error: message }` |
| `ConflictError` | 409 `{ error: message }` |
| `ForbiddenError` | 403 `{ error: message }` |
| Unknown error | 500 `{ error: "Internal server error" }` |

Frontend pages display errors in a styled alert banner above the table, consistent with the existing Cache Metrics page pattern.

## Component Structure

```
app/admin/
├── layout.tsx                          ← Sidebar with nav links (modified)
├── organizations/page.tsx              ← Upgraded: Lucide icon buttons + edit modal
├── permissions/
│   └── page.tsx                        ← Rebuilt: paginated table + modal forms
├── roles/
│   └── page.tsx                        ← New: paginated table + modal forms
└── users/
    └── page.tsx                        ← New: paginated table + modal forms

app/api/admin/
├── organizations/route.ts              ← Already uses OrganizationService
├── permissions/
│   ├── route.ts                        ← Migrated: PermissionService
│   └── [id]/route.ts                   ← New: PATCH/DELETE via PermissionService
├── roles/
│   ├── route.ts                        ← New: RoleService CRUD
│   └── [roleId]/route.ts               ← New: single-resource PATCH/DELETE
└── users/
    ├── route.ts                        ← New: UserService CRUD
    └── [userId]/route.ts               ← New: single-resource PATCH/DELETE

components/admin/
├── EditModal.tsx                       ← Reusable modal for create/edit forms
├── ConfirmDialog.tsx                   ← Reusable delete confirmation dialog
└── DataTable.tsx                       ← (Optional) Shared paginated table component
```

## Pagination Strategy

All pages use the same pagination approach as Organizations:
- Server-side pagination via API query params (`page`, `pageSize`)
- Default page size: 20 (configurable per model if needed)
- Page state managed in React with `useState`
- Filter changes reset to page 1 (same pattern as Org page's `fetchKey` mechanism)
- Debounced search input (200ms timeout, same as Org page)

## Security Considerations

1. **All routes protected by `requireSuperAdmin()`** — Non-Super Admin users receive 403.
2. **CSRF protection** — POST/PATCH/DELETE routes validate `SameSite` request headers via `isSameSiteRequest()`.
3. **Audit logging** — Every create/update/delete action is recorded via `recordAuditLog()`.
4. **RLS context** — Routes that use `globalDb` set RLS context via `setRLSContext()` (where applicable).
5. **Service-layer authorization** — Services enforce their own role checks (`requirePlatformAdmin`, `requireAnyAdmin`) as a defense-in-depth measure.
