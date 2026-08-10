# Proposal: BetterAuth Teams Integration

## Intent
Integrate BetterAuth's **Teams** feature into the Property NI Multi-Tenant Portal data model. Teams provide a sub-organizational grouping layer, allowing users to be organized into functional units (e.g., "Maintenance Team A", "Letting Agents") within a single organization. Each team can have default roles automatically assigned to all its members, enabling role inheritance at the team level.

This proposal extends the existing BetterAuth Organization plugin (established in `project-initialization`) by enabling its built-in Teams mode and building a comprehensive service layer, REST endpoints, tenant isolation coverage, and test suite around it.

---

## References & Foundational Rules
This proposal builds upon and must strictly adhere to the rules, design system, and infrastructure established in:
- **`project-initialization`**: Core architecture, tenant isolation (defense-in-depth), BetterAuth setup, Prisma schema conventions.
- **`auth-and-rbac`**: RBAC system with `Permission`, `Role`, `RolePermission`, and `MemberRole` models.

**Mandatory Rules from prior proposals enforced in this proposal:**
- **Unified Architecture:** Single Next.js origin. No separate backend servers.
- **Version Pinning:** Node.js 22 LTS, Next.js 15, React 19.
- **Database & ORM:** PostgreSQL only, Prisma ORM.
- **Tenant Isolation:** `organizationId` is mandatory on all organization-scoped models. The defense-in-depth strategy (Prisma Extension + RLS) must not be bypassed by team logic.
- **Secrets Management:** No real secrets committed to GitHub.
- **Design System:** Property NI Navy & Amber tokens for any new UI components.

## Non-Regression Requirements
This proposal MUST NOT break any functionality established in previous proposals:
- **Organization CRUD:** Existing `OrganizationService` methods must continue to work unchanged.
- **RBAC System:** Role and permission resolution must remain unaffected by team membership.
- **Tenant Isolation:** All team-scoped queries must respect the existing `organizationId` scoping.
- **Session Management:** BetterAuth session augmentation must not be invalidated by team-related changes.

## Scope

### In scope
- **Prisma Schema Updates:** Add `Team` and `TeamMember` tables; add optional `teamId` to `Invitation`; update `Member` model with `teamId`.
- **Default "Members" Team:** Every new organization is bootstrapped with a default team named "Members".
- **Team-to-Role Assignment:** A `TeamRole` junction model linking teams to organization-scoped roles, with automatic role assignment when a user joins a team.
- **REST Endpoints:** Full CRUD for teams and team membership under `/api/organizations/[orgId]/teams/*`.
- **Organization Service Extensions:** New `TeamService` with CRUD operations, add/remove member functions, and team-role management.
- **Authorization:** Organization admins can CRUD teams in their org; Platform super-admins can operate on any organization's teams.
- **Tenant Isolation:** `Team` and `TeamMember` are org-scoped — included in Prisma extension scoping, RLS policy scaffolding, and ESLint exempt lists.
- **BetterAuth Config:** Enable `teams: { enabled: true }` in the organization plugin; scaffold team-specific hooks.
- **Testing:** Unit tests for `TeamService`, integration tests for team CRUD and membership operations, isolation tests verifying cross-org team data leakage is impossible.
- **Documentation:** Detailed Prisma and DB SQL data model document in `documents/feature-planning-and-development/`.
- **Developer Profile Seeding:** Update `prisma/seed.ts` to create a default developer profile: Platform organization with its team and platform user, plus one tenant organization with one team containing two tenant users.
- **Testing Profile Seeding:** Update `prisma/seed.ts` to create a default testing profile: Platform organization with its team and platform test user, plus one tenant organization with one team containing two tenant users.

### Out of scope (Deferred)
- **Team-scoped permissions** — Teams follow the organization's permission system; per-team permission sets are deferred.
- **Active team context in middleware** — The tenant middleware continues to operate at the organization level only. Team selection is a UI concern for now.
- **Team-level RLS policies** — Scaffolding only; actual policies added when business tables reference teams.
- **Team invitation UI** — Backend APIs for team-specific invitations are included; the UI is deferred.
- **Team analytics or reporting** — No dashboards for team metrics.

## Execution Boundary
This proposal will generate:
1. **Prisma schema updates** — New models, field additions, and migration scaffolding.
2. **New service file** — `services/team-service.ts` with full CRUD and membership management.
3. **REST route handlers** — Team and team-member endpoints under `/api/organizations/[orgId]/teams/`.
4. **BetterAuth config update** — Enable teams mode and scaffold hooks in `lib/auth.ts`.
5. **Tenant isolation updates** — Prisma extension, RLS template, and ESLint exempt list adjustments.
6. **Test files** — Unit tests (`tests/unit/team-service.test.ts`), integration tests (`tests/integration/team-lifecycle.test.ts`, `tests/integration/team-membership.test.ts`), isolation tests (`tests/isolation/application/team-isolation.test.ts`).
7. **Documentation** — Detailed data model document in `documents/feature-planning-and-development/betterauth-teams-data-model.md`.
8. **Developer profile seeding** — Update `prisma/seed.ts` to bootstrap a developer-ready environment: Platform org + team + platform user, one tenant org + team + 2 tenant users.
9. **Testing profile seeding** — Update `prisma/seed.ts` to bootstrap a test-ready environment: Platform org + team + platform test user, one tenant org + team + 2 tenant users.

## Approach
Enable BetterAuth's built-in Teams mode via the Organization plugin configuration. Extend the Prisma schema with `Team` and `TeamMember` tables (plus `TeamRole` for role inheritance). Build a dedicated `TeamService` following the existing service layer pattern (`services/organization-service.ts`), with authorization checks for platform admins and tenant admins. Scaffold REST endpoints using Next.js Route Handlers. Enforce tenant isolation on all new models via the existing defense-in-depth strategy. Bootstrap a default "Members" team on every organization creation.

---

## Deferred Items Registry Update

The following item is **promoted** from the deferred registry in `project-initialization`:

| # | Feature | Previous Status | New Status |
| :--- | :--- | :--- | :--- |
| — | **BetterAuth Teams** | 📋 Planned (deferred) | ✅ Promoted to Active |

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| BetterAuth internal schema changes in future versions | Medium | Pin `better-auth` version; wrap team operations in service layer to minimize coupling to internal types. |
| Team membership affects permission resolution performance | Low | Permissions are cached in Redis (per `auth-and-rbac`); team role assignments trigger cache invalidation. |
| Default "Members" team bootstrapping adds latency to org creation | Low | Bootstrap is a single Prisma insert; negligible overhead. |
| Cross-org team data leakage via new models | Critical | `Team` and `TeamMember` include `organizationId`; included in Prisma extension scoping and RLS scaffolding. |
