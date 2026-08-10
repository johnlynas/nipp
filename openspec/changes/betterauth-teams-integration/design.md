# Design: BetterAuth Teams Integration

## Technical Approach
- **Teams Mode:** Enabled via `organization({ teams: { enabled: true } })` in BetterAuth config.
- **Schema:** Prisma models `Team`, `TeamMember`, and `TeamRole` added to the existing schema.
- **Service Layer:** New `team-service.ts` following the established pattern (input types, error classes, authorization guards).
- **REST API:** Next.js Route Handlers under `app/api/organizations/[orgId]/teams/`.
- **Tenant Isolation:** All team models are org-scoped with `organizationId`; covered by Prisma extension and RLS.
- **Role Inheritance:** `TeamRole` links teams to organization roles; automatic assignment on member join.

---

## Architecture Decisions

### Decision: Team and TeamMember as Prisma Models (Not Relying Solely on BetterAuth Internal Schema)
BetterAuth's Organization plugin manages `Team` and `TeamMember` tables internally. We will define these models explicitly in the Prisma schema to maintain full type safety, enable custom fields, and ensure tenant isolation coverage.

*Why:* Relying on BetterAuth's internal schema generation means the models are invisible to Prisma's type system and our tenant-scoped extension. Explicit schema definitions give us:
1. Full TypeScript types for all team operations.
2. Automatic `organizationId` scoping via the Prisma extension.
3. RLS policy generation for team tables.
4. Ability to add custom fields (e.g., `description`, `icon`) without fighting BetterAuth's schema extension API.

### Decision: Default "Members" Team on Organization Creation
Every new organization is automatically bootstrapped with a default team named "Members" (slug: `members`). All organization members are added to this team by default unless explicitly assigned to a different team.

*Why:* BetterAuth requires at least one team when teams mode is enabled. The "Members" team serves as the catch-all for users who are organization members but not assigned to any functional team. This mirrors common patterns (e.g., GitHub's default team structure).

### Decision: TeamRole Junction Model for Role Inheritance
A new `TeamRole` model links teams to organization-scoped roles. When a user is added to a team, all roles associated with that team are automatically assigned to the user via `MemberRole` junction records.

```
Team ──1..N── TeamRole ──N..1── Role
```

*Why:* BetterAuth's built-in team model does not include role inheritance. By introducing `TeamRole`, we enable:
1. **Default team roles:** A "Maintenance" team can have the "Maintenance Staff" role pre-assigned, so every new member gets that role automatically.
2. **Flexibility:** Teams can have zero, one, or multiple default roles.
3. **Separation of concerns:** Team membership (who is in the team) is distinct from role assignment (what permissions they get).

### Decision: Dedicated TeamService (Not Extending OrganizationService)
Team operations live in a new `services/team-service.ts`, not as methods on the existing `OrganizationService`.

*Why:*
1. **Single Responsibility:** OrganizationService manages organizations; TeamService manages teams and team membership. Clear separation improves testability and maintainability.
2. **Authorization boundaries:** Platform admins operate across all orgs; tenant admins are scoped to one org. The service pattern already supports this via `ServiceContext`.
3. **Parallel development:** Team features can evolve independently of organization management.

### Decision: REST Endpoint Structure
Team endpoints follow the existing pattern under `/api/organizations/[orgId]/teams/`:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/organizations/[orgId]/teams` | List all teams in the organization |
| POST | `/api/organizations/[orgId]/teams` | Create a new team |
| GET | `/api/organizations/[orgId]/teams/[teamId]` | Get team details with members and roles |
| PATCH | `/api/organizations/[orgId]/teams/[teamId]` | Update team details |
| DELETE | `/api/organizations/[orgId]/teams/[teamId]` | Delete a team (must be empty or transfer members) |
| POST | `/api/organizations/[orgId]/teams/[teamId]/members` | Add a member to the team |
| DELETE | `/api/organizations/[orgId]/teams/[teamId]/members` | Remove a member from the team |
| GET | `/api/organizations/[orgId]/teams/[teamId]/members` | List team members |
| POST | `/api/organizations/[orgId]/teams/[teamId]/roles` | Assign a role to the team |
| DELETE | `/api/organizations/[orgId]/teams/[teamId]/roles` | Remove a role from the team |

*Why:* This structure mirrors the existing organization API patterns and provides clear RESTful semantics. The `[orgId]` segment ensures the organization context is always explicit in the URL.

### Decision: User Membership Constraints
- **A user can be a member of multiple teams within the same organization.** (Enforced by `TeamMember` having unique constraint on `[userId, teamId]`, not `[userId, organizationId]`.)
- **A user can belong to only one organization.** (Already enforced by the existing `Member` model's unique constraint on `[userId, orgId]` and the `User.activeOrganizationId` field.)

*Why:* The multi-org constraint is a business requirement for Property NI — each user has exactly one active organization. Within that org, multi-team membership enables realistic organizational structures (e.g., a property manager who is on both the "Leasing Team" and "Maintenance Coordination Team").

### Decision: BetterAuth Team Hooks Scaffolding
Team-specific hooks are scaffolded in `lib/auth.ts` but left as no-op stubs, following the pattern established by other deferred hooks in the initialization proposal.

*Why:* Hooks provide extension points for future features (e.g., `afterCreateTeam` → create default team resources; `beforeRemoveTeamMember` → cleanup user's team-specific data). Scaffolding them now prevents future refactoring when these features are implemented.

### Decision: Tenant Isolation for Team Models
`Team` and `TeamMember` are organization-scoped models. They must be:
1. Included in the Prisma extension's scoping list (so all queries are automatically filtered by `organizationId`).
2. Covered by RLS policy scaffolding (template migration demonstrating the pattern).
3. Added to the ESLint exempt list for direct `prisma` imports (since they are org-scoped, not global).

*Why:* Without these measures, a bug in the application layer could allow cross-org team data leakage. The defense-in-depth strategy requires every org-scoped model to be covered at both layers.

### Decision: Developer Profile Seeding in `prisma/seed.ts`
The seed script MUST bootstrap a complete developer-ready environment with both platform and tenant profiles, including teams.

**Developer profile structure:**
```
Platform Organization ("Platform")
├── Team: "Platform Ops"
│   └── Member: platform-dev@nipp.gov.uk (Super Admin, added to team)
│
Tenant Organization: "Dev Tenant Ltd"
├── Team: "Operations"
│   ├── Member: dev-tenant-a@example.com (Tenant User A)
│   └── Member: dev-tenant-b@example.com (Tenant User B)
```

*Why:* Developers need a ready-to-use environment with platform and tenant contexts, complete with team memberships, so they can immediately test team CRUD, membership operations, and role inheritance without manual setup. Credentials are driven by `.env` variables for flexibility.

### Decision: Testing Profile Seeding in `prisma/seed.ts`
The seed script MUST bootstrap a complete test-ready environment with both platform and tenant profiles, including teams. This is separate from the developer profile to avoid test interference.

**Testing profile structure:**
```
Platform Organization ("Platform")
├── Team: "Platform Ops"
│   └── Member: platform-test@nipp.gov.uk (Super Admin Test User, added to team)
│
Tenant Organization: "Test Tenant Ltd"
├── Team: "QA Operations"
│   ├── Member: test-tenant-a@example.com (Test Tenant User A)
│   └── Member: test-tenant-b@example.com (Test Tenant User B)
```

*Why:* Integration and isolation tests need predictable, isolated test data. The testing profile uses dedicated email addresses and passwords (configurable via `TEST_*` env vars) so tests can run without interfering with developer data. The structure mirrors the developer profile to ensure test coverage is equivalent.

### Decision: Seeding Mode Detection
The seed script uses environment variables to determine which profile(s) to create:
- **Dev mode** (default): Creates the developer profile using `ADMIN_EMAIL`/`ADMIN_PASSWORD` for platform credentials and configurable tenant credentials.
- **Test mode** (`TEST_ADMIN_EMAIL` set): Creates the testing profile using `TEST_*` env vars for all credentials.
- Both modes create the default "Members" team on every organization (existing behavior, extended to new tenant orgs).

*Why:* This mirrors the existing pattern in `seed.ts` (which already detects test mode via `TEST_ADMIN_EMAIL`). Keeping the same convention avoids confusion and allows CI pipelines to use the test profile while developers use the dev profile.

---

## Data Model Overview (Detailed in Documentation)

See `documents/feature-planning-and-development/betterauth-teams-data-model.md` for the complete Prisma schema definitions, SQL DDL statements, relationship diagrams, and usage patterns.

### Key Relationships
```
Organization 1──N Team          (org has many teams)
Team      1──N TeamMember       (team has many members)
User      N──1 TeamMember       (user can be in many teams)
Team      1──N TeamRole         (team has many default roles)
Role      N──1 TeamRole         (role can be a default for many teams)
Member    1──N MemberRole       (member has many roles, including team-inherited)
```

### New Tables Summary
| Table | Purpose | Org-Scoped? | Key Fields |
|-------|---------|-------------|------------|
| `Team` | Functional grouping within an org | Yes | `organizationId`, `name`, `slug` |
| `TeamMember` | User-to-team membership | Yes | `teamId`, `userId`, `organizationId` |
| `TeamRole` | Team-to-role inheritance mapping | Yes | `teamId`, `roleId`, `organizationId` |

### Modified Tables
| Table | Change | Reason |
|-------|--------|--------|
| `Invitation` | Add optional `teamId?` field | Allow inviting users directly to a team |
| `Member` | Add optional `teamId?` field (BetterAuth internal) | BetterAuth's member model supports team association when teams are enabled |
