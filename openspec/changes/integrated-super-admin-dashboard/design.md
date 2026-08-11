# Design: Integrated Super Admin Dashboard

## Technical Approach

- **Route Group:** `app/dashboard/admin/` with its own layout (`layout.tsx`) and page components for each panel.
- **Data Flow:** Client components → API routes (`/api/dashboard/admin/*`) → Service layer (`services/organization-service.ts`, etc.) → Prisma (globalDb for cross-org, tenantDb within context).
- **State Management:** React Query (`@tanstack/react-query`) already configured in `Providers`. All panels use `useQuery`/`useMutation` hooks for data fetching and mutations.
- **Form Handling:** Zod schemas (existing in `lib/schemas/`) for validation. Forms use controlled components with React state.
- **Collapsible Sidebar:** State managed via `useState` in the layout component. CSS transitions for smooth slide-in/out animation.
- **API Client:** Centralized fetch wrapper in `lib/api-client.ts` for consistent error handling and auth header injection.

## Architecture Decisions

### Decision: Separate Route Group from Existing `/admin/*`
Create a new route group at `app/dashboard/admin/` rather than modifying the existing `/admin/*` structure.
*Why:* The requirement is to leave the current admin dashboard untouched. A separate route group ensures zero risk of regression and allows both dashboards to coexist during transition.

### Decision: Dedicated API Routes Under `/api/dashboard/admin/*`
New REST endpoints live under their own namespace, separate from existing `/api/admin/*` and `/api/organizations/[orgId]/teams/*`.
*Why:* Clear separation of concerns. The new dashboard has its own API contract. Existing APIs continue to serve the old dashboard and any external consumers without modification.

### Decision: Service Layer as Single Source of Truth
All API routes delegate to the existing service layer (`OrganizationService`, `UserService`, `TeamService`, `RoleService`, `PermissionService`). No direct Prisma calls in API routes.
*Why:* The service layer already encapsulates authorization checks, tenant isolation, and Redis cache invalidation. Reusing it ensures consistency and avoids duplicating business logic.

### Decision: Client Components for All Panels
All dashboard panels are client components (`'use client'`) that fetch data via API routes and React Query.
*Why:* Dashboard UIs are highly interactive (search, filter, modals, multi-select). Client components provide the responsiveness needed. Server components would add unnecessary complexity for this use case.

### Decision: Shared Component Library in `components/dashboard/`
Reusable UI primitives live in a dedicated directory, separate from existing `components/ui/` (which doesn't exist yet) and `components/admin/`.
*Why:* Keeps the new dashboard's components organized and reusable across panels. Avoids polluting existing component directories.

### Decision: Multi-Select for Relationship Management
Roles↔Permissions and User↔Roles relationships use multi-select dropdown components with search.
*Why:* These are many-to-many relationships that need to display all options, allow searching within large lists, and show current assignments clearly.

### Decision: Stat Cards as Panel Header
Each panel starts with a row of stat cards showing key metrics (total count, active counts, etc.).
*Why:* Provides immediate context and aligns with the mockup pattern. Uses the existing Property NI design tokens.

### Decision: Modal Dialogs for Detail Views and Forms
User details, org details, create/edit forms all use modal dialogs rather than separate pages.
*Why:* Keeps the user in context within the panel. Reduces navigation overhead for common CRUD operations.

### Decision: No shadcn/ui Dependency
The new dashboard uses raw Tailwind CSS classes rather than introducing shadcn/ui components.
*Why:* The project currently has no shadcn/ui setup (no `components/ui/` directory). Introducing it would be a large dependency change. The Property NI design system with custom Tailwind tokens is sufficient and consistent with the existing admin dashboard.

### Decision: lucide-react for Sidebar Icons
Use `lucide-react` (already installed) for all sidebar and action icons.
*Why:* Already a dependency, consistent with the existing codebase. Icons used: `Users`, `Building2`, `UsersRound` (Teams), `Shield`, `Key`.

## UI Layout Structure

### Dashboard Shell (`app/dashboard/admin/layout.tsx`)

```
┌──────────────┬─────────────────────────────────────────────────┐
│              │  Property NI — Integrated Dashboard      [Avatar]│
│  NAV         ├─────────────────────────────────────────────────┤
│              │                                                 │
│  [≡] Users   │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐          │
│              │  │Total │ │Active│ │Banned│ │Verified│         │
│  Organizations│  │Users │ │Now   │ │     │ │      │          │
│              │  │ 142  │ │  23  │ │   5  │ │  137 │          │
│  Teams       │  └──────┘ └──────┘ └──────┘ └──────┘          │
│              │                                                 │
│  Roles       │  ┌─────────────────────────────────────┐        │
│              │  │ [🔍 Search users by name or email...] [+ Add User]│
│  Permissions │  ├─────────────────────────────────────┤        │
│              │  │ User       │ Role   │ Status │ Actions│        │
│              │  ├────────────┼────────┼────────┼────────┤        │
│              │  │ Alice      │ admin  │ ✓Verif │ 👁 🛡️ │        │
│              │  │ Bob        │ user   │ ✓Verif │ 👁 🛡️ │        │
│              │  └────────────┴────────┴────────┴────────┘        │
│              │                                                 │
├──────────────┴─────────────────────────────────────────────────┤
│ Sidebar collapses to icon-only (w-16) or full (w-64)           │
└─────────────────────────────────────────────────────────────────┘
```

### Sidebar Navigation Items

| Icon (lucide-react) | Label | Route |
|---|---|---|
| `Users` | Users | `/dashboard/admin/users` |
| `Building2` | Organizations | `/dashboard/admin/organizations` |
| `UsersRound` | Teams | `/dashboard/admin/teams` |
| `Shield` | Roles | `/dashboard/admin/roles` |
| `Key` | Permissions | `/dashboard/admin/permissions` |

### Panel Layout Pattern (Consistent Across All Panels)

```
┌─────────────────────────────────────────────────┐
│ [Stat Card] [Stat Card] [Stat Card] [Stat Card] │  ← 4-column grid
├─────────────────────────────────────────────────┤
│ [Search Input]                    [+ Primary Btn] │  ← Toolbar
├─────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────┐ │
│ │ Header Row                                  │ │
│ ├─────────────────────────────────────────────┤ │
│ │ Data Row 1              [Actions]           │ │
│ │ Data Row 2              [Actions]           │ │
│ │ ...                                         │ │
│ └─────────────────────────────────────────────┘ │  ← Table / Cards
├─────────────────────────────────────────────────┤
│ Showing X of Y results                          │  ← Footer
└─────────────────────────────────────────────────┘
```

## Property NI Design System Reference

### Brand Colors (MANDATORY)
- **Navy Blue:** `#1B2A4A` — Sidebar background, headers, primary text
- **Amber/Gold:** `#F5A623` — Primary buttons, CTAs, active states, focus rings
- **Surface Default:** `#ffffff` — Card backgrounds, table rows
- **Surface Subtle:** `#f8f9fa` — Page background (content area)
- **Border Default:** `#dee2e6` — Subtle borders on cards and tables

### Semantic Colors
- **Success (Active/Verified):** `text-green-700` / `bg-green-50`
- **Warning (Pending):** `text-amber-700` / `bg-amber-50`
- **Danger (Banned/Suspended/Error):** `text-red-700` / `bg-red-50`
- **Neutral (Archived/Inactive):** `text-gray-600` / `bg-gray-50`

### Typography
- **Font:** Inter (already configured in `globals.css`)
- **Headings:** `font-semibold` for panel titles, `font-bold` for stat card values
- **Body:** Default weight, `text-sm` for table cells

### Accessibility (a11y) Requirements
- All icon-only buttons MUST include `aria-label` attributes.
- Status badges MUST have sufficient color contrast and include text labels.
- All interactive elements must be keyboard accessible (Enter/Space to activate, Escape to close modals).
- Tables must have proper `<th>` headers with `scope="col"`.

## API Route Structure

```
/api/dashboard/admin/
├── users/
│   ├── route.ts              # GET (list), POST (create)
│   └── [id]/
│       ├── route.ts          # GET (detail), PATCH (update), DELETE
│       └── ban/
│           └── route.ts      # POST (toggle ban)
├── organizations/
│   ├── route.ts              # GET (list), POST (create)
│   └── [id]/
│       ├── route.ts          # GET (detail), PATCH (update)
│       └── status/
│           └── route.ts      # PATCH (suspend/reactivate/archive)
├── teams/
│   ├── route.ts              # GET (list by org), POST (create)
│   └── [id]/
│       ├── route.ts          # GET (detail), PATCH (update), DELETE
│       └── members/
│           └── route.ts      # GET, POST (add), DELETE (remove)
│       └── roles/
│           └── route.ts      # GET, POST (assign), DELETE (revoke)
├── roles/
│   ├── route.ts              # GET (list by org), POST (create)
│   └── [id]/
│       ├── route.ts          # GET (detail), PATCH (update), DELETE
│       └── permissions/
│           └── route.ts      # GET, POST (assign), DELETE (revoke)
│       └── members/
│           └── route.ts      # GET (list assigned members)
├── permissions/
│   └── route.ts              # GET (list catalog), POST (create)
└── stats/
    └── route.ts              # GET (aggregate stats across all models)
```

## Testing Strategy & Mocking Rules

1. **Hoisting:** All `vi.mock()` calls MUST be placed at the very top of the test file, before any imports.
2. **Prisma Mocking:** Mock at the service layer level (`services/organization-service.ts`), not at the Prisma client level. This tests the business logic without needing database fixtures.
3. **API Route Tests:** Use `@testing-library/dom` and `msw` (if available) or manual fetch mocking to test route handlers.
4. **Integration Tests:** Verify end-to-end CRUD flows using the actual service layer with a test database (via `docker-compose.test.yml`).
5. **Isolation Tests:** Verify that the new dashboard API routes are properly gated by `requireSuperAdmin()` and cannot be accessed by non-platform users.

### Mocking Example
```typescript
vi.mock('@/services/organization-service', () => ({
  OrganizationService: {
    list: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    create: vi.fn().mockResolvedValue({ id: 'org_123', name: 'Test Org' }),
    update: vi.fn().mockResolvedValue({ id: 'org_123', name: 'Updated Org' }),
    delete: vi.fn().mockResolvedValue({ success: true }),
  },
}));
```

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| New dashboard conflicts with existing `/admin/*` routes | Low | Separate route group (`/dashboard/admin`) ensures no path collisions. |
| Service layer changes in future proposals break API routes | Medium | API routes delegate to services; if service interfaces change, only the API layer needs updating. Service tests catch breaking changes first. |
| Large permission catalog slows multi-select rendering | Low | Multi-select component includes search/filter; virtualization deferred if needed. |
| Redis cache invalidation missed on role/permission changes | High | Service layer already handles this (`data-model-services` proposal). API routes call service methods, not Prisma directly. |
| Sidebar state lost on navigation | Low | State managed in layout component (parent of all panels). Persists across panel switches. |
