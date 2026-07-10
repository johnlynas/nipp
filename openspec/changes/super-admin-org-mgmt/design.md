# Design: Super Admin Organization Management

## Technical Approach
- **Global DB Access:** Separate unscoped Prisma client (`lib/global-db.ts`) guarded by `requireSuperAdmin()`.
- **Organization States:** Enum field `OrgStatus` with values: `PENDING`, `ACTIVE`, `SUSPENDED`, `ARCHIVED`.
- **Audit Logging:** `AuditLog` Prisma model with structured fields.
- **Notifications:** Branded email service with rate limiting (max 5 per event type).
- **UI:** Next.js App Router with server components for data, client components for interactions. Property NI Navy & Amber design tokens.
- **UI Access Control:** Strict enforcement using `<RequireSuperAdmin>` and `useIsSuperAdmin()` hooks.

## Architecture Decisions

### Decision: Explicitly Unscoped Global Database Client
Create `lib/global-db.ts` that exports a Prisma client WITHOUT the tenant isolation extension.
*Why:* Super Admins need to query across all organizations. A separate, explicitly named `globalDb` client makes it visually obvious when we are bypassing tenant isolation. Access is strictly gated by `requireSuperAdmin()` route wrappers.

### Decision: Organization Lifecycle State Machine
Organizations follow a strict state machine: `PENDING` → `ACTIVE` ↔ `SUSPENDED` → `ARCHIVED` (terminal).
*Why:* Provides clear, auditable lifecycle management. Suspended orgs preserve data but block user access. Archived orgs are terminal.

### Decision: Audit Log in PostgreSQL (Same Database)
Store audit logs in the same PostgreSQL database using a dedicated `AuditLog` table.
*Why:* Keeps infrastructure simple, enables transactional consistency, and allows easy querying. 1-year retention with periodic cleanup.

### Decision: Hybrid Audit Logging Strategy
Use middleware to automatically log all mutations to `/api/admin/*` and `/api/roles/*` routes, combined with explicit `auditLog.record()` calls for special cases requiring additional metadata.

### Decision: Fixed-Rule Notification System
Notifications use fixed rules (no per-admin preferences) with a maximum of 5 notifications per event type per 24-hour window. Email is the initial channel.

### Decision: Roles Tab at Both Super Admin and Org Admin Levels
Both views include a "Roles" tab. Super Admins see roles for the selected organization with full CRUD. Org Admins see only their organization's roles with custom-role-only CRUD.

### Decision: Default Role Protection for Org Admins
Org Admins can view the 7 default roles but cannot edit or delete them. Only Super Admins can modify default roles.

### Decision: Domain-Agnostic Organization Model
The Organization model contains only universal fields. Domain-specific configuration is handled through roles, permissions, and a JSONB `metadata` field.

### Decision: Strict Platform Organization Gating for Admin UI
All Super Admin dashboard pages (`/admin/*`) and navigation links must be gated by Platform Organization membership. We will introduce a `<RequireSuperAdmin>` wrapper component.
*Why:* Permissions can be misassigned. Membership in the Platform Organization is a hard, structural boundary.

### Decision: Automatic Slug Generation with Conflict Resolution
When an organization is created, the backend MUST automatically generate a URL-friendly slug from the organization name (e.g., "Acme Properties Ltd" -> "acme-properties-ltd"). If the generated slug already exists, the system MUST append a numeric suffix (e.g., "acme-properties-ltd-1") to guarantee uniqueness.

### Decision: Property NI Design System for All UI
All new UI components use the established Property NI Navy (`#1B2A4A`) and Amber (`#F5A623`) tokens via Tailwind CSS.

## UI Layout Structure (Based on Approved Mockup)

### Super Admin Dashboard (`/admin/organizations`)

┌─────────────────────────────────────────────────────────────────────────┐
│ Property NI Admin [Logout] │ <-- Navy Blue Header
├─────────────────────────────────────────────────────────────────────────┤
│ [Organizations] Permissions Audit Log │ <-- Tabs (Amber underline for active)
├─────────────────────────────────────────────────────────────────────────┤
│ │
│ Organizations │
│ Manage tenant organizations │
│ │
│ [+ Create Organization] [Status: All / Active / Pending / ... v] │ <-- Amber Button + Filter
│ │
│ ─────────────────────────────────────────────────────────────────── │
│ │ Organization Name │ Status │ Members │ Created Date │ Actions│ │
│ ├──────────────────────┼───────────┼─────────┼──────────────┼────────┤ │
│ │ Acme Properties Ltd │ [Active] │ 12 │ Jan 5, 2026 │ ⋮ │ │ <-- Green Badge
│ │ Belfast Rentals │ [Pending] │ 0 │ Mar 1, 2026 │ 👁 ⋮ │ │ <-- Amber Badge
│ │ Dublin Estates │[Suspended]│ 8 │ Feb 3, 2026 │ ✎ 👁 ⋮ │ │ <-- Red Badge
│ └───────────────────────────────────────────────────────────────────┘ │
─────────────────────────────────────────────────────────────────────────


## Property NI Design System Reference

### Brand Colors (MANDATORY)
- **Navy Blue:** `#1B2A4A` (Headers, navigation bars, primary text)
- **Amber/Gold:** `#F5A623` (Primary buttons, CTAs, active states, focus rings)

### Semantic Colors
- **Success (Active):** `bg-green-500`
- **Warning (Pending):** `bg-amber-500`  
- **Danger (Suspended/Error):** `bg-red-500`
- **Neutral (Archived):** `bg-gray-400`

### Accessibility (a11y) Requirements
- All icon-only buttons (e.g., Edit, Delete, View in tables) MUST include an `aria-label` attribute.
- Status badges MUST have sufficient color contrast and include the text label inside the badge.

## Testing Strategy & Mocking Rules

1. **Hoisting:** All `vi.mock()` calls MUST be placed at the very top of the test file, before any imports.
2. **Prisma Mocking:** 
   ```typescript
   vi.mock('@/lib/db', () => ({
     prisma: { organization: { findMany: vi.fn(), create: vi.fn() } }
   }));

      vi.mock('@/lib/redis', () => ({
     getRedis: vi.fn(() => ({ get: vi.fn(), set: vi.fn(), del: vi.fn() }))
   }));