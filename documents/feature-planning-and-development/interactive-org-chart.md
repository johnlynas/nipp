# Interactive Organization Chart

## Overview

This document is the design spec and implementation plan for the Interactive Organization Chart feature of the Property NI Multi-Tenant Portal.

The org chart is a responsive, interactive tree generated from live database data — Organization → Team → TeamMember → User/Member/Role/Permission. It is presented as a page in the interactive admin dashboard (`/dashboard/admin/org-chart`), with a right-hand slide-in panel that mirrors the Calendar page's interaction pattern: a typeable organization combobox, collapsed/expanded states, and the same dark visual language. An admin user can choose which organization's chart to view and edit; organization members can view it, in the same way the Calendar is set up. A new "Org Chart" menu entry is added to the left slide-in navigation of the admin dashboard.

All required data already exists in the Prisma schema — no new business tables are needed:

| Relationship | Models |
|--------------|--------|
| Organization 1──N Team | `Organization`, `Team` (org-scoped) |
| Team 1──N TeamMember | `Team`, `TeamMember` (join, org-scoped) |
| User ↔ TeamMember | `User` (global), `TeamMember` |
| Member 1──N MemberRole | `Member` (org membership + BetterAuth role), `MemberRole`, `Role` |
| RBAC | `Role`, `RolePermission`, `Permission` (global catalog) |

**Source plan:** `.hermes/plans/2026-09-14_120000-org-chart.md`

**Status:** Implemented (v1, commit `cd2874f`) — see [Implementation Status](#implementation-status) for shipped scope and divergences.

---

## Motivation

- Members and admins currently have no visual way to see the organization's who-reports-to-whom hierarchy across teams.
- The Calendar page (`app/dashboard/admin/calendar/page.tsx` + `components/calendar/CalendarSidebar.tsx`) already establishes the exact interaction pattern this feature follows:
  - full-bleed page (no top header bar) inside the admin dashboard,
  - right-hand dark (`#1B2A4A`) slide-in sidebar with collapsed (`w-16`) / expanded (`w-80`) states,
  - typeable organization combobox,
  - super-admin `?org=` query param switcher fed by `GET /api/admin/organizations/list`.
- No schema migration is required; the feature is a read-only projection of existing tenant data plus one new API route and UI components.

---

## Scope

### In scope (v1)

1. **Data endpoint** — `GET /api/organizations/[orgId]/org-chart` returning the full org tree JSON in one call.
2. **Org chart page** — `app/dashboard/admin/org-chart/page.tsx`, a client component mirroring the calendar page's init flow (active org from `/api/auth/me`, `localStorage` fallback, `?org=` super-admin override).
3. **Right slide-in panel** — `components/org-chart/OrgChartSidebar.tsx`, mirroring `CalendarSidebar.tsx` (typeable org combobox for super admins, fixed own-org display for tenant admins, management links, team list, unassigned list).
4. **Interactive tree** — `components/org-chart/OrgChart.tsx`: expand/collapse per node, zoom in/out + reset, drag-to-pan, node click → detail popup, responsive vertical accordion layout on mobile, keyboard accessible.
5. **Left sidebar nav entry** — new "Org Chart" item (lucide `Network` icon) in `app/dashboard/admin/layout.tsx`, plus extending the calendar's full-bleed layout condition to the org-chart path.
6. **Seed update** — new `org-chart:read` permission in the global permission catalog (`prisma/seed.ts`, `isDefault: true`), mirroring `calendar:read` grants, so future role gating is available.
7. **Tests** — unit (tree-shaper, component render), integration (API authz matrix), isolation (cross-tenant read attempts), optional Playwright e2e.

### Out of scope (deferred)

- Drag-and-drop re-parenting of members/teams in the tree UI (existing team members endpoints will be reused when added in v2).
- Explicit reporting lines (`reportsTo` / `Team.leaderId`) — the schema has no manager relation; the hierarchy is org → team → member. If reporting lines are wanted, that is a separate schema-change proposal.
- Printing / PDF export.
- Tenant-facing org chart page (org-admin self-service route, e.g. `/dashboard/owner/org-chart`) and any non-super-admin cross-org browsing — v1 is the super-admin dashboard only (see Decisions); v2 work.
- 1:1 team-member enforcement at the schema/index level (the API resolves multiple memberships to a primary one in v1 instead).
- Caching (data is small; Redis/hybrid cache is a v2 consideration).

---

## Assumptions

- **Chart shape:** Level 0 = organization; Level 1 = teams (alphabetical) plus a root-attached "Unassigned" group for members with no team membership; Level 2 = members, each showing user name/email, their BetterAuth member role, assigned role names, and a permission summary (counts on node, keys in the detail popup).
- **Edit bounds (v1):** the panel exposes (a) the org switcher, (b) per-section "Manage" navigation links to the existing admin management pages (members, teams, roles, settings). No new mutation endpoints — inline member moves land in v2 on top of the existing `POST/DELETE /api/organizations/[orgId]/teams/[teamId]/members` endpoints, which already enforce `isSameSiteRequest` CSRF.
- **Visibility:** any member of the displayed organization can view the chart (mirrors calendar event access — membership check). Editing affordances are gated on `viewerCanEdit` (tenant admin or super admin). In v1 the page audience is super admins only; the tenant-admin path is already server-side-ready for v2.
- **Tenant isolation is non-negotiable** (see the tenant-isolation header in `prisma/schema.prisma`): the read API verifies membership for non-super-admin callers, same pattern as `app/api/organizations/[orgId]/teams/route.ts`.
- **Styling:** calendar tokens — sidebar `bg-[#1B2A4A]`, borders `#24355c` / `#3a4f7a`, accent `#F5A623`, lucide-react icons, Tailwind only. No new tree/chart UI dependency in v1 (hand-rolled CSS layout).

---

## Data Shape & API

### Endpoint: `GET /api/organizations/[orgId]/org-chart`

Authorization, in order:

1. `requireSuperAdmin` (`lib/require-super-admin.ts`) passes → proceed for any `orgId`.
2. Otherwise membership check `globalDb.member.findFirst({ where: { userId, orgId } })` → **403** if missing.
3. (v1 simplification, matching calendar access) membership alone is sufficient to read one's own org's chart. The `org-chart:read` permission key is added to the catalog now for future tightening via `lib/permissions/resolver`.

Response:

```jsonc
{
  "organization": { "id": "...", "name": "...", "description": "..." },
  "viewerCanEdit": true,                     // super admin or tenant admin of this org
  "teams": [
    {
      "id": "...", "slug": "...", "name": "...", "description": "...",
      "members": [
        {
          "userId": "...",
          "name": "...", "email": "...", "image": null,
          "memberRole": "admin",                    // BetterAuth role from Member
          "assignedRoles": [                         // MemberRole -> Role -> RolePermission -> Permission
            { "id": "...", "name": "Property Manager",
              "permissionCount": 5, "permissions": ["properties:read", "..."] }
          ],
          "teams": ["operations"]                    // team slugs the member belongs to
        }
      ]
    }
  ],
  "unassigned": [ /* ChartMember[] — members with no TeamMember row in this org */ ]
}
```

### Query strategy

One Prisma read on `globalDb`:

- `organization.findUnique({ where: { id: orgId }, include: { teams: { include: { members: { include: { user: true, team: true } } } } } })`
- plus org-level `members: { include: { user, memberRoles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } }`

Rows are shaped into the tree shape above by a **pure function** in `lib/org-chart.ts` (unit-testable without a database). `unassigned` = org members whose `userId` does not appear in any `TeamMember` for that org.

---

## Frontend Design

### Page — `app/dashboard/admin/org-chart/page.tsx`

Clone of `app/dashboard/admin/calendar/page.tsx` structure:

- Init order: `GET /api/auth/me` → `activeOrganizationId` + `organizationName`; fallback `localStorage.getItem("nipp-active-org-id")`; super-admin `?org` URL override resolved against `GET /api/admin/organizations/list`.
- Loading state ("Loading org chart…") and "No organization selected" state, same color tokens (`#1B2A4A` text) as the calendar page.
- Renders `<OrgChart organizationId={orgId} organizationName={...} sidebarOpen onSidebarToggle onOrganizationSelected onMemberClick />`.

Full-bleed layout is enabled in `app/dashboard/admin/layout.tsx` by extending the existing calendar condition:

```tsx
const isCalendarPage  = pathname === '/dashboard/admin/calendar';
const isOrgChartPage  = pathname === '/dashboard/admin/org-chart';
const isFullScreenPage = isCalendarPage || isOrgChartPage;
// used at the top-header condition and the <main> padding/overflow condition
```

### Left navigation entry — `app/dashboard/admin/layout.tsx`

Add to `navItems` (after Calendar):

```tsx
{ href: '/dashboard/admin/org-chart', label: 'Org Chart', icon: Network }
```

(`Network` imported from `lucide-react`, matching the icon-size/hover/active styles already on the list.)

### Right slide-in panel — `components/org-chart/OrgChartSidebar.tsx`

Mirrors `components/calendar/CalendarSidebar.tsx` exactly — same collapsed (`w-16`) / expanded (`w-80`) transition, same toggle button, same typeable combobox behaviour (focus opens the list, live substring filter, Enter picks first match, Escape resets, outside-click closes, `onMouseDown={(e) => e.preventDefault()}` on options to survive blur).

Expanded sections, in order:

1. **Organization combobox**
   - Super admin: all orgs from `GET /api/admin/organizations/list` (Platform first, as on the calendar).
   - Tenant admin: single fixed display of their own org name, no combobox (matches calendar behaviour for non-super-admins).
2. **Manage** (rendered only when `viewerCanEdit` is true):
   - Settings → `/admin/organizations/[orgId]/settings`
   - Members → `/admin/organizations/[orgId]/members`
   - Teams → members page (teams are managed through members/teams routes in this codebase)
   - Roles → `/admin/organizations/[orgId]/roles`
3. **Teams** list: each team with its member count; clicking a team expands/scrolls to that team's subtree in the chart (callback into `OrgChart`).
4. **Unassigned members** (if any): click opens the member detail popup in the tree.

`viewerCanEdit` is computed server-side in the endpoint (super-admin status + `membership.role === 'admin'`) so the client needs no additional role plumbing. In v1 the page audience is super admins (see Decisions), so the flag is always true for anyone reaching the page; it is kept because (a) the API endpoint is independently callable and (b) v2 tenant access will rely on it without further work.

### Interactive tree — `components/org-chart/OrgChart.tsx`

- **Props:** `tree: ChartTree`, `canEdit: boolean`, `onMemberClick(member)`, `onTeamClick(teamId)`.
- **Layout (desktop):** absolute-positioned tree inside a pannable canvas — organization root centered at top; teams in a horizontal row beneath; members fanned vertically under each team. Pure CSS (flex/grid + transforms).
- **Interactions:**
  - Click node → expand/collapse that level (team member lists collapsed by default); top level always visible.
  - Double-click (or a "Details" button) on a member node → detail modal (reusing `components/dashboard/Modal.tsx`): name, email, member role, assigned roles with expandable permission key list, and all team memberships.
  - Zoom in / out / reset button cluster, top-right overlay; zoom is `transform: scale` on the inner canvas.
  - Pan by dragging the canvas background; single-finger pan on touch (pinch zoom deferred).
  - When `canEdit`: member nodes expose a small action menu with "Manage" navigation links (same targets as the sidebar).
- **Responsive:** below the `md` breakpoint the spatial tree switches to a vertical indented accordion layout (organization → teams → members) so phones get a usable list rather than a tiny zoomable canvas. This is the "responsive" deliverable.
- **Accessibility:** the tree container uses `role="tree"` / `role="treeitem"`; every node is a `<button>` with `aria-expanded` / `aria-controls`; keyboard: Tab moves focus, Enter/Space toggles, ArrowRight expands, ArrowLeft collapses, Enter on a member opens details.
- **Team membership display (1:1 in v1):** each member is rendered under exactly one team — no "also in" badge, no duplicated member nodes. The `TeamMember` schema still permits multiple memberships; if that occurs, the endpoint picks the primary membership (earliest `createdAt`, ties broken by team name) and renders the member there only. Enforcing 1:1 at the data level (unique index / schema change) is deferred.

### TypeScript types — `components/org-chart/types.ts`

```ts
export interface ChartRole {
  id: string;
  name: string;
  permissionCount: number;
  permissions: string[];
}

export interface ChartMember {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  memberRole: string;
  assignedRoles: ChartRole[];
  teams: string[]; // team slugs
}

export interface ChartTeam {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  members: ChartMember[];
}

export interface ChartTree {
  organization: { id: string; name: string; description: string | null };
  teams: ChartTeam[];
  unassigned: ChartMember[];
  viewerCanEdit: boolean;
}
```

---

## Files

### New

| File | Purpose |
|------|---------|
| `app/dashboard/admin/org-chart/page.tsx` | Org chart page (client component, calendar-page pattern) |
| `app/api/organizations/[orgId]/org-chart/route.ts` | Read endpoint (authz matrix above) |
| `lib/org-chart.ts` | Pure tree shaper (rows → `ChartTree`), unit-testable |
| `components/org-chart/types.ts` | `ChartTree` / `ChartMember` / `ChartTeam` / `ChartRole` |
| `components/org-chart/OrgChart.tsx` | Interactive tree (canvas, zoom, pan, responsive accordion) |
| `components/org-chart/OrgChartNode.tsx` | Single node (org / team / member) render + a11y |
| `components/org-chart/OrgChartSidebar.tsx` | Right slide-in panel (calendar-sidebar clone) |
| `components/org-chart/OrgChartDetailModal.tsx` | Member detail popup (Modal-based) |
| `tests/unit/org-chart-tree.test.ts` | Tree shaper unit tests |
| `tests/unit/OrgChart.test.tsx`, `tests/unit/OrgChartSidebar.test.tsx` | jsdom component render tests |
| `tests/integration/org-chart.test.ts` | API authz matrix integration tests |
| `tests/isolation/application/org-chart-isolation.test.ts` | Cross-tenant isolation spec |

### Modified

| File | Change |
|------|--------|
| `app/dashboard/admin/layout.tsx` | New nav item (`Network` icon) + `isFullScreenPage` condition for the org-chart path |
| `prisma/seed.ts` | `org-chart:read` (+ `org-chart:update` reserved) in the default permission catalog with admin grants, mirroring `calendar:read` (line 67 pattern) |

No change to `lib/require-super-admin.ts` or to any Prisma schema file (no migration).

---

## Tenant Isolation

The endpoint follows the existing org-scoped read pattern from `app/api/organizations/[orgId]/teams/route.ts`: session → membership (or super-admin) gate → data read on `globalDb`. Defense-in-depth stays intact:

1. **Application layer** — membership/super-admin check before any query; the shape function never crosses org boundaries because the query is org-scoped at the root (`organization.findUnique` + its org-scoped relations).
2. **Database layer** — `Team`, `TeamMember`, `Role`, `MemberRole`, `RolePermission` all carry `organizationId` and are covered by Prisma extension + RLS per the schema header and `lib/rls.ts`.
3. **Test layer** — a new isolation spec (modeled on `tests/isolation/application/team-isolation.test.ts`): org A user requesting org B's chart → 403; super admin requesting any org → 200.

---

## Seed / Permission Impact

```ts
// prisma/seed.ts — added to DEFAULT_PERMISSIONS (mirrors calendar:* entries):
{ key: 'org-chart:read',   resource: 'org-chart', action: 'read',   description: 'View the organization chart', isDefault: true },
{ key: 'org-chart:update', resource: 'org-chart', action: 'update', description: 'Edit organization chart membership', isDefault: true },
```

Grants follow the existing `calendar:read` grant pattern for tenant admin / super admin roles. Existing databases pick the new defaults up on the next bootstrap (`lib/org-bootstrap.ts`); dev environments via `npm run db:seed`. No migration is required — the `Permission` catalog is global and seed-managed.

---

## Testing / Validation Plan

1. `npm run type-check`
2. `npm run lint`
3. `npm run test` (unit) — tree shaper + component render
4. `npm run test:integration` — API authz matrix:
   - anonymous → 401
   - member of org → 200, full tree
   - member of another org → 403
   - non-member → 403
   - tenant admin → 200 + `viewerCanEdit: true`
   - super admin for any `orgId` → 200 + `viewerCanEdit: true`
5. `npm run test:isolation` (CI) — cross-tenant read attempts blocked
6. Manual pass: `npm run dev`, super-admin login → left menu "Org Chart":
   - super admin: org combobox switches tenants (URL `?org=` survives refresh), tree renders, sidebar open/close, node expand/collapse, zoom/pan, mobile viewport (devtools responsive) shows vertical accordion
   - non-members hitting the API get 403 (covered by isolation tests); page itself is super-admin only (RequireSuperAdmin layout)
7. `npm run build` clean

---

## Decisions (Resolved)

1. **Chart depth:** org → team → member is sufficient for v1. No reporting lines (`Team.leaderId` / `Member.managingMemberId`); if reporting lines become a product requirement, that is a separate schema-change proposal.
2. **Team–member display:** v1 treats the relationship as 1:1 — each member is rendered under exactly one team, no "also in" badge, no duplicated member nodes. The `TeamMember` schema still permits multiple memberships; if the data ever contains them, the endpoint picks the primary membership (earliest `createdAt`, ties broken by team name) and renders the member there only. Schema/index-level 1:1 enforcement is deferred.
3. **Dashboard audience:** v1 is scoped to the super-admin dashboard only (`/dashboard/admin/org-chart`, inside the `RequireSuperAdmin` layout). Tenant access to the org chart (org-admin self-service route, e.g. `/dashboard/owner/org-chart`) waits until v2.

## Risks / Tradeoffs

1. **Large orgs (hundreds of members):** collapse-by-default per team keeps the DOM small; virtualization deliberately deferred (YAGNI).
2. **CSRF:** v1 is read-only, so no new CSRF surface; v2 inline member moves reuse the existing `POST/DELETE` team-members endpoints, which already enforce `isSameSiteRequest`.
3. **Seed change rollout:** new default permissions land via the next org bootstrap / re-seed; verify `lib/org-bootstrap.ts` picks them up during the pre-release check.

---

## Acceptance Criteria

- Super admin sees "Org Chart" in the left sidebar; the page loads their active org's chart.
- The right slide-in panel (identical look/feel to the calendar sidebar) opens and closes; its org combobox switches tenants for the super admin, with `?org=` surviving refresh.
- The tree renders organization → teams → members from live DB data; roles and permissions are visible per member (detail popup).
- Collapse/expand, zoom, and pan work on desktop; mobile shows the vertical accordion layout.
- Organization members can view the chart; non-members are rejected (403) per the API + isolation tests.
- Super admins see edit affordances for every organization (tenant-admin self-service view is v2).
- `npm run test`, `npm run lint`, `npm run type-check`, and `npm run build` all pass.

---

## Implementation Status

The feature shipped in commit `cd2874f` (`feat(org-chart): add interactive
organization chart`) and matches this plan with the following divergences —
this section is the as-built record; where it conflicts with an earlier
section above, this one wins.

**Shipped (per plan):** data endpoint + authz matrix, full-bleed page with
`?org=` super-admin switcher, slide-in sidebar (combobox / Manage links / team
list / unassigned), interactive canvas (org node toggles the team row —
visible by default — plus per-team expand/collapse, zoom 50–200%,
drag-to-pan; diagram opens centred in the viewport; mouse-wheel zoom toward
the cursor — roll forward in, roll back out — and middle-click recentres),
detail modal reusing the
shared `Modal`, mobile vertical accordion below 768 px, `role="tree"`/`treeitem`
+ keyboard accessibility, 1:1 primary-membership display with unassigned
bucketing, the two seeded permissions (`org-chart:read`, `org-chart:update`),
unit tests for the shaper and integration tests for the authz matrix, and a
matching left-nav entry in the admin layout.

**Divergences:**

- **Authz helper** — the route uses the shared `resolveTenantAccess` gate
  (`lib/tenant-access.ts`, same as the calendar/teams routes) rather than a
  standalone `requireSuperAdmin` + manual membership check; outcome is
  identical (401 / 403 / 503-fail-closed, super admin sees any org).
- **Manage links** — the sidebar's Manage section exposes *Organization
  settings*, *Members*, and *Roles*. There is no separate "Teams" link; teams
  are managed through the members page in this codebase.
- **Sidebar member clicks** — clicking a (unassigned) member *in the sidebar*
  opens that user's admin view page (`/admin/users/[userId]/view`); the
  detail **modal** is opened from inside the tree canvas, as planned.
- **Test coverage** — unit (shaper) and integration (authz matrix) suites
  shipped. The planned jsdom component-render tests
  (`tests/unit/OrgChart*.test.tsx`) and the isolation spec
  (`tests/isolation/application/org-chart-isolation.test.ts`) were **not**
  included in v1; cross-tenant rejection is asserted inside the integration
  matrix (403 cases) until a dedicated isolation spec lands.
