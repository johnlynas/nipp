# Design: Resource Data Model

## Technical Approach

- **Schema Location:** `prisma/schema.prisma` — new models added at the end of the file, following the existing model ordering convention.
- **Service Location:** `services/resource-service.ts` — follows the singleton service pattern established by `PermissionService`, `RoleService`, etc.
- **DB Access:** Both `Resource` and `ResourceRole` are global models, so the service uses `globalDb` for all queries.
- **Authorization:** All operations require `PLATFORM_ADMIN` role, enforced via `requirePlatformAdmin(ctx)` from `lib/services/base-service.ts`.
- **Error Handling:** Typed error classes (`ValidationError`, `ForbiddenError`, `NotFoundError`, `ConflictError`) from `lib/services/types.ts`.
- **API Routes:** Follow the same pattern as existing dashboard API routes — `requireSuperAdmin()` at the top of each handler, then delegate to the service layer.
- **UI:** Client component following the established dashboard page pattern — `PageHeader` + `StatCard`s + `SearchBar` + `DataTable` + `Modal`/`ConfirmDialog`.
- **Testing:** Vitest unit tests with mocked `globalDb`.

## Architecture Decisions

### Decision: Global Models for Resource and ResourceRole
Both `Resource` and `ResourceRole` are global (non-org-scoped) models.

*Why:* Resources represent portal-wide feature areas that are shared across all tenants. The access control decision (which roles can access a resource) is managed at the platform level by Super Admins. Individual organizations do not create or manage their own resources — they inherit the global resource catalog and control access via org-scoped role assignments.

### Decision: ResourceRole Junction Table Structure
`ResourceRole` is a global junction table with foreign keys to both `Resource` and `Role`:

```prisma
model ResourceRole {
  id             String   @id @default(cuid())
  createdAt      DateTime @default(now())

  resourceId     String
  resource       Resource @relation(fields: [resourceId], references: [id], onDelete: Cascade)

  roleId         String
  role           Role     @relation(fields: [roleId], references: [id], onDelete: Cascade)

  @@unique([resourceId, roleId]) // A role can only be assigned once per resource
}
```

*Why:* This creates a clean many-to-many relationship between global Resources and org-scoped Roles. The `roleId` foreign key implicitly enforces that the referenced role belongs to a valid organization (via Prisma's referential integrity). No `organizationId` is needed on `ResourceRole` because:
1. The table itself is global — it does not contain tenant data.
2. Org scoping is enforced transitively via `ResourceRole.roleId → Role.organizationId`.
3. The Prisma Extension tenant isolation does not apply to global models, so no `organizationId` scoping is required.

### Decision: Service Uses `globalDb`, Not `tenantDb`
The service uses the global Prisma client (`lib/global-db.ts`) for all queries.

*Why:* Both `Resource` and `Role` are queried via the global client. The `Role` model is org-scoped, but since we're operating at the platform level (Super Admin), we need to query roles across all organizations. Using `globalDb` is the established pattern for Super Admin operations (see `PermissionService`, `UserService`).

### Decision: Safety Check on Resource Delete
The `delete()` method checks for assigned roles before allowing deletion.

*Why:* Deleting a resource while it still has role assignments would silently break the access control mapping. A `ConflictError` with a clear message ("Cannot delete resource with assigned roles") prevents accidental data loss and alerts the admin to remove role assignments first.

### Decision: No State Machine on Resource
Resources have no lifecycle states — just CRUD with timestamps.

*Why:* Resources are feature definitions, not entities that go through a business process. A resource is either defined or it isn't. If a feature is deprecated, the Super Admin can simply remove role assignments from it (or delete it if no roles are assigned). Adding states would add complexity without clear benefit.

### Decision: Resource Name is the Primary Identifier
The `name` field serves as the human-readable identifier for a resource. No slug or URL-friendly variant is needed.

*Why:* Resources are managed exclusively through the Super Admin dashboard, not exposed in URLs or public APIs. The `name` is sufficient for display and search purposes. If URL-friendly identifiers become necessary in the future, a `slug` field can be added via an additive migration.

### Decision: Sidebar Icon — `Layers` from lucide-react
The new sidebar nav item uses the `Layers` icon.

*Why:* The `Layers` icon semantically represents a feature/module grouping concept — layers of functionality stacked within the platform. It is distinct from existing icons (`UserRound`, `Building2`, `UsersRound`, `Shield`, `Key`) and clearly communicates "feature catalog" to the user.

### Decision: Nav Order — Resources After Permissions
The new "Resources" nav item is placed after "Permissions" in the sidebar.

*Why:* This maintains a logical flow: Users → Organizations → Teams → Roles → Permissions → Resources. Resources sit at the end as the outermost access control layer (they gate feature visibility, while permissions gate specific actions within features).

## UI Layout Structure

### Dashboard Sidebar (Updated)

```
┌──────────────┐
│  NAV         │
│              │
│ [Layers] Resources    ← NEW
│ [Key]  Permissions
│ [Shield] Roles
│ [UsersRound] Teams
│ [Building2] Organizations
│ [UserRound] Users
│              │
├──────────────┤
│ [LogOut]     │
└──────────────┘
```

### Resources Page Layout (Consistent with Existing Dashboard Pages)

```
┌─────────────────────────────────────────────────┐
│ Resources                                       │  ← PageHeader (title + description)
│ Feature modules and their role-based access     │
│                              [+ Create Resource]│
├─────────────────────────────────────────────────┤
│ ┌──────┐                                        │  ← StatCards row
│ │Total │ │Assigned│                              │
│ │Res.  │ │Roles   │                              │
│ │  12  │ │  8     │                              │
│ └──────┘ └────────┘                              │
├─────────────────────────────────────────────────┤
│ [🔍 Search resources...]                        │  ← SearchBar
├─────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────┐ │
│ │ Name              │ Roles Assigned  │ Actions│ │
│ ├───────────────────┼─────────────────┼────────┤ │
│ │ Maintenance       │ Manager, Tech   │ 👁 ✏ 🗑│ │
│ │ Work Orders       │ Manager         │ 👁 ✏ 🗑│ │
│ └───────────────────┴─────────────────┴────────┘ │  ← DataTable
├─────────────────────────────────────────────────┤
│ Showing X of Y results                          │  ← PaginationControls
└─────────────────────────────────────────────────┘
```

### Create/Edit Modal Pattern (Consistent with Existing Dashboard Modals)

```
┌──────────────────────────────────────┐
│  Create Resource              [✕]    │
├──────────────────────────────────────┤
│                                      │
│  Name *                              │
│  ┌──────────────────────────────┐   │
│  │ Maintenance Requests         │   │
│  └──────────────────────────────┘   │
│                                      │
│  Description                         │
│  ┌──────────────────────────────┐   │
│  │ Manage maintenance requests  │   │
│  └──────────────────────────────┘   │
│                                      │
│  Assigned Roles                      │
│  ┌──────────────────────────────┐   │
│  │ [MultiSelect: Manager, Tech] │   │
│  └──────────────────────────────┘   │
│                                      │
│              [Cancel]  [Save]        │
└──────────────────────────────────────┘
```

## Property NI Design System Reference

### Brand Colors (MANDATORY)
- **Navy Blue:** `#1B2A4A` — Sidebar background, table headers, primary text
- **Amber/Gold:** `#F5A623` — Primary buttons, CTAs, active states, focus rings
- **Surface Default:** `#ffffff` — Card backgrounds, table rows, modal backgrounds
- **Surface Subtle:** `#f8f9fa` — Page background (content area)
- **Border Default:** `#dee2e6` — Subtle borders on cards and tables

### Semantic Colors
- **Success (Active/Verified):** `text-green-700` / `bg-green-50`
- **Warning (Pending):** `text-amber-700` / `bg-amber-50`
- **Danger (Error/Delete):** `text-red-700` / `bg-red-50`
- **Neutral (Inactive):** `text-gray-600` / `bg-gray-50`

### Typography
- **Font:** Inter (already configured in `globals.css`)
- **Headings:** `font-semibold` for panel titles, `font-bold` for stat card values
- **Body:** Default weight, `text-sm` for table cells

### Accessibility (a11y) Requirements
- All icon-only buttons MUST include `aria-label` attributes.
- All interactive elements must be keyboard accessible (Enter/Space to activate, Escape to close modals).
- Tables must have proper `<th>` headers with `scope="col"`.

## API Route Structure

```
/api/dashboard/admin/resources/
├── route.ts              # GET (list), POST (create)
└── [id]/
    └── route.ts          # GET (detail), PATCH (update), DELETE
```

### Endpoint Details

**GET /api/dashboard/admin/resources**
- Query params: `page` (default 1), `pageSize` (default 20, max 100), `search` (optional)
- Response: `{ items: Resource[], pagination: { page, pageSize, total, totalPages } }`
- Auth: `requireSuperAdmin()` — returns 401/403 if not a Super Admin

**POST /api/dashboard/admin/resources**
- Body: `{ name: string, description?: string, roleIds?: string[] }`
  - `name`: required, unique (case-insensitive)
  - `description`: optional string
  - `roleIds`: optional array of role IDs to assign to the resource
- Response: created Resource object (201)
- Auth: `requireSuperAdmin()`

**GET /api/dashboard/admin/resources/[id]**
- Response: Resource object with `resourceRoles` relation populated (assigned roles)
- Auth: `requireSuperAdmin()`

**PATCH /api/dashboard/admin/resources/[id]**
- Body: `{ name?: string, description?: string, roleIds?: string[] }`
  - `roleIds`: if provided, replaces all existing role assignments (full replacement semantics)
- Response: updated Resource object
- Auth: `requireSuperAdmin()`

**DELETE /api/dashboard/admin/resources/[id]**
- Safety check: if `ResourceRole` count > 0, returns 409 Conflict with message
- Response: `{ success: true }` (200) or error (404/409)
- Auth: `requireSuperAdmin()`

## Testing Strategy & Mocking Rules

1. **Hoisting:** All `vi.mock()` calls MUST be placed at the very top of the test file, before any imports.
2. **Prisma Mocking:** Mock at the service layer level (`services/resource-service.ts`), not at the Prisma client level. This tests the business logic without needing database fixtures.
3. **Unit Tests:** Use Vitest with mocked `globalDb` to verify:
   - Correct Prisma queries are called for each CRUD method.
   - Authorization logic: `PLATFORM_ADMIN` access granted, other roles denied.
   - Error handling: typed errors with correct status codes.
   - Pagination, filtering, and sorting logic.

### Mocking Example
```typescript
vi.mock('@/lib/global-db', () => ({
  default: {
    resource: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    resourceRole: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));
```

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| `ResourceRole` links global (`Resource`) to org-scoped (`Role`) — Prisma relation constraints | Medium | Use explicit foreign key fields with `@relation` annotations. No `organizationId` on `ResourceRole`; org scoping is enforced transitively via `roleId → Role.organizationId`. |
| Accidental resource deletion removing role access mappings | Medium | `delete()` checks for assigned roles; throws `ConflictError` if any exist. Admin must remove assignments first. |
| Name uniqueness across all resources (case-insensitive) | Low | Enforce unique constraint on `name` with a case-insensitive index. Service layer checks for duplicates before create/update. |
| Sidebar nav item not appearing due to layout changes | Low | The sidebar is a simple array iteration. Adding one entry to `navItems` cannot break existing items. |
