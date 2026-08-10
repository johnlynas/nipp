# Tasks: BetterAuth Teams Integration

## Phase 1: Schema & Database Migration

- [ ] **Task 1.1:** Update `prisma/schema.prisma` — Add `Team`, `TeamMember`, and `TeamRole` models with all fields, relations, indexes, and constraints
- [ ] **Task 1.2:** Update `prisma/schema.prisma` — Add optional `teamId?` field to `Invitation` model
- [ ] **Task 1.3:** Update `prisma/schema.prisma` — Add optional `teamId?` field to `Member` model (BetterAuth internal schema alignment)
- [ ] **Task 1.4:** Run `prisma validate` to verify schema correctness
- [ ] **Task 1.5:** Run `prisma generate` to regenerate Prisma Client
- [ ] **Task 1.6:** Create migration `prisma/migrations/0001_add_teams_model/migration.sql` with DDL for `Team`, `TeamMember`, `TeamRole` tables and `teamId` additions
- [ ] **Task 1.7:** Apply migration to local PostgreSQL database and verify tables are created correctly
- [ ] **Task 1.8:** Update `prisma/seed.ts` — Add default "Members" team bootstrapping logic for existing organizations (one-time seed script)
- [ ] **Task 1.9:** Update `prisma/seed.ts` — Add environment variable definitions for developer and testing profiles (document in `.env.example`)

## Phase 2: BetterAuth Configuration

- [ ] **Task 2.1:** Update `lib/auth.ts` — Enable teams mode: `organization({ teams: { enabled: true } })`
- [ ] **Task 2.2:** Update `lib/auth.ts` — Scaffold team-specific hooks (no-op stubs): `beforeCreateTeam`, `afterCreateTeam`, `beforeUpdateTeam`, `afterUpdateTeam`, `beforeDeleteTeam`, `afterDeleteTeam`, `beforeAddTeamMember`, `afterAddTeamMember`, `beforeRemoveTeamMember`, `afterRemoveTeamMember`
- [ ] **Task 2.3:** Update client-side auth config — Enable teams in `organizationClient` plugin configuration
- [ ] **Task 2.4:** Verify BetterAuth session augmentation includes team data in the user's organization context

## Phase 3: Service Layer

- [ ] **Task 3.1:** Create `services/team-service.ts` — Define input/output types (`CreateTeamInput`, `UpdateTeamInput`, `AddTeamMemberInput`, etc.)
- [ ] **Task 3.2:** Implement `TeamService.createTeam()` — Create a team within an organization; platform admin can create in any org, tenant admin only in their own
- [ ] **Task 3.3:** Implement `TeamService.getTeamById()` — Retrieve a team with its members and assigned roles
- [ ] **Task 3.4:** Implement `TeamService.getTeamsByOrg()` — List all teams in an organization (paginated)
- [ ] **Task 3.5:** Implement `TeamService.updateTeam()` — Update team name/description; authorization checks same as create
- [ ] **Task 3.6:** Implement `TeamService.deleteTeam()` — Delete a team; must handle orphaned members (transfer to "Members" team or require empty team)
- [ ] **Task 3.7:** Implement `TeamService.addTeamMember()` — Add a user to a team; automatically assign all team roles via `MemberRole` junction
- [ ] **Task 3.8:** Implement `TeamService.removeTeamMember()` — Remove a user from a team; revoke team-inherited roles (preserve org-level roles)
- [ ] **Task 3.9:** Implement `TeamService.listTeamMembers()` — List all members of a team with their roles
- [ ] **Task 3.10:** Implement `TeamService.assignTeamRole()` — Assign an organization role to a team (creates `TeamRole` record)
- [ ] **Task 3.11:** Implement `TeamService.removeTeamRole()` — Remove a role assignment from a team
- [ ] **Task 3.12:** Implement `TeamService.getTeamRoles()` — List all roles assigned to a team
- [ ] **Task 3.13:** Add authorization guards — `requireOrgAdmin()` and `requirePlatformAdmin()` for team operations
- [ ] **Task 3.14:** Add audit logging — Log all team CRUD and membership operations via `lib/audit.ts`

## Phase 4: REST Endpoints

- [ ] **Task 4.1:** Create `app/api/organizations/[orgId]/teams/route.ts` — GET (list) and POST (create)
- [ ] **Task 4.2:** Create `app/api/organizations/[orgId]/teams/[teamId]/route.ts` — GET (details), PATCH (update), DELETE (delete)
- [ ] **Task 4.3:** Create `app/api/organizations/[orgId]/teams/[teamId]/members/route.ts` — GET (list), POST (add), DELETE (remove)
- [ ] **Task 4.4:** Create `app/api/organizations/[orgId]/teams/[teamId]/roles/route.ts` — GET (list), POST (assign), DELETE (remove)
- [ ] **Task 4.5:** Add input validation with Zod schemas for all endpoints
- [ ] **Task 4.6:** Add error handling — consistent JSON error responses with proper HTTP status codes
- [ ] **Task 4.7:** Add middleware — verify organization context and authentication before route handlers execute

## Phase 5: Tenant Isolation Updates

- [ ] **Task 5.1:** Update `lib/tenant-db.ts` — Add `Team`, `TeamMember`, and `TeamRole` to the org-scoped models list in the Prisma extension
- [ ] **Task 5.2:** Update `lib/tenant-db.ts` — Add `Team`, `TeamMember`, and `TeamRole` to the exempt models list (they are org-scoped, not global)
- [ ] **Task 5.3:** Update ESLint config — Add `Team`, `TeamMember`, `TeamRole` to the exempt models list for the "no direct prisma import" rule
- [ ] **Task 5.4:** Create RLS template migration `prisma/migrations/0001_add_teams_model/migration.sql` — Include RLS enablement and policy creation for `Team`, `TeamMember`, and `TeamRole` tables
- [ ] **Task 5.5:** Update tenant isolation documentation — Add team models to the exempt and scoped model lists

## Phase 6: Testing

### Unit Tests
- [ ] **Task 6.1:** Create `tests/unit/team-service.test.ts` — Test all `TeamService` methods with mocked Prisma
- [ ] **Task 6.2:** Test `createTeam` — Platform admin creates in any org; tenant admin restricted to own org; validation errors
- [ ] **Task 6.3:** Test `updateTeam` — Authorization checks; partial updates; slug immutability for tenant admins
- [ ] **Task 6.4:** Test `deleteTeam` — Platform org protection; non-empty team rejection; successful deletion
- [ ] **Task 6.5:** Test `addTeamMember` — User must be an org member first; automatic role assignment via TeamRole
- [ ] **Task 6.6:** Test `removeTeamMember` — Revokes team-inherited roles; preserves org-level roles
- [ ] **Task 6.7:** Test `assignTeamRole` / `removeTeamRole` — Role must belong to the same organization; duplicate prevention
- [ ] **Task 6.8:** Test authorization — `ForbiddenError` for unauthorized users; `NotFoundError` for non-existent teams

### Integration Tests
- [ ] **Task 6.9:** Create `tests/integration/team-lifecycle.test.ts` — Full CRUD lifecycle with real database
- [ ] **Task 6.10:** Test team creation → list → update → delete with real Prisma client
- [ ] **Task 6.11:** Test default "Members" team bootstrapping on organization creation
- [ ] **Task 6.12:** Create `tests/integration/team-membership.test.ts` — Team membership operations with real database
- [ ] **Task 6.13:** Test add member → list members → remove member lifecycle
- [ ] **Task 6.14:** Test team role assignment and automatic member role inheritance
- [ ] **Task 6.15:** Test cross-org team isolation — verify teams from different orgs are never mixed

### Isolation Tests
- [ ] **Task 6.16:** Create `tests/isolation/application/team-isolation.test.ts` — Application-layer tenant isolation for team models
- [ ] **Task 6.17:** Test that a user in Org A cannot read, update, or delete teams from Org B
- [ ] **Task 6.18:** Test that team membership queries are correctly scoped to the active organization

## Phase 7: Documentation & Seeding

- [ ] **Task 7.1:** Create `documents/feature-planning-and-development/betterauth-teams-data-model.md` — Detailed Prisma schema, SQL DDL, relationship diagrams, and usage patterns
- [ ] **Task 7.2:** Update `ARCHITECTURE.md` — Add section on Teams architecture and data model
- [ ] **Task 7.3:** Update `README.md` — Add setup instructions for teams feature (environment variables, migration steps)
- [ ] **Task 7.4:** Update `openspec/changes/project-initialization/proposal.md` — Remove Teams from deferred items registry
- [ ] **Task 7.5:** Update `.env.example` — Add developer profile seeding variables (`DEV_PLATFORM_EMAIL`, `DEV_PLATFORM_PASSWORD`, `DEV_TENANT_A_EMAIL`, `DEV_TENANT_A_PASSWORD`, `DEV_TENANT_B_EMAIL`, `DEV_TENANT_B_PASSWORD`)
- [ ] **Task 7.6:** Update `.env.example` — Add testing profile seeding variables (`TEST_PLATFORM_EMAIL`, `TEST_PLATFORM_PASSWORD`, `TEST_TENANT_A_EMAIL`, `TEST_TENANT_A_PASSWORD`, `TEST_TENANT_B_EMAIL`, `TEST_TENANT_B_PASSWORD`)

## Phase 8: Developer Profile Seeding

- [ ] **Task 8.1:** Update `prisma/seed.ts` — Add developer profile section: create Platform organization team ("Platform Ops") if not exists
- [ ] **Task 8.2:** Update `prisma/seed.ts` — Add developer profile section: add the default platform user (from `ADMIN_EMAIL`) to the Platform Ops team via `TeamMember` record
- [ ] **Task 8.3:** Update `prisma/seed.ts` — Add developer profile section: create tenant organization "Dev Tenant Ltd" (slug: `dev-tenant-ltd`) if not exists
- [ ] **Task 8.4:** Update `prisma/seed.ts` — Add developer profile section: create default "Members" team for the dev tenant organization
- [ ] **Task 8.5:** Update `prisma/seed.ts` — Add developer profile section: create tenant user A (`DEV_TENANT_A_EMAIL`) with credential account if not exists
- [ ] **Task 8.6:** Update `prisma/seed.ts` — Add developer profile section: create tenant user B (`DEV_TENANT_B_EMAIL`) with credential account if not exists
- [ ] **Task 8.7:** Update `prisma/seed.ts` — Add developer profile section: add both tenant users as members of the dev tenant organization
- [ ] **Task 8.8:** Update `prisma/seed.ts` — Add developer profile section: add both tenant users to the "Operations" team (create team if not exists) via `TeamMember` records
- [ ] **Task 8.9:** Update `prisma/seed.ts` — Add developer profile section: assign default organization roles to both tenant users via `MemberRole` records
- [ ] **Task 8.10:** Verify developer profile seeding — run `prisma db seed` and confirm all entities exist with correct relationships

## Phase 9: Testing Profile Seeding

- [ ] **Task 9.1:** Update `prisma/seed.ts` — Add testing profile section: detect test mode via `TEST_ADMIN_EMAIL` env var (reuse existing pattern)
- [ ] **Task 9.2:** Update `prisma/seed.ts` — Add testing profile section: create Platform organization team ("Platform Ops") if not exists
- [ ] **Task 9.3:** Update `prisma/seed.ts` — Add testing profile section: add the default platform test user (from `TEST_ADMIN_EMAIL`) to the Platform Ops team via `TeamMember` record
- [ ] **Task 9.4:** Update `prisma/seed.ts` — Add testing profile section: create tenant organization "Test Tenant Ltd" (slug: `test-tenant-ltd`) if not exists
- [ ] **Task 9.5:** Update `prisma/seed.ts` — Add testing profile section: create default "Members" team for the test tenant organization
- [ ] **Task 9.6:** Update `prisma/seed.ts` — Add testing profile section: create tenant user A (`TEST_TENANT_A_EMAIL`) with credential account if not exists
- [ ] **Task 9.7:** Update `prisma/seed.ts` — Add testing profile section: create tenant user B (`TEST_TENANT_B_EMAIL`) with credential account if not exists
- [ ] **Task 9.8:** Update `prisma/seed.ts` — Add testing profile section: add both test tenant users as members of the test tenant organization
- [ ] **Task 9.9:** Update `prisma/seed.ts` — Add testing profile section: add both test tenant users to the "QA Operations" team (create team if not exists) via `TeamMember` records
- [ ] **Task 9.10:** Update `prisma/seed.ts` — Add testing profile section: assign default organization roles to both test tenant users via `MemberRole` records
- [ ] **Task 9.11:** Verify testing profile seeding — run `prisma db seed` in test mode and confirm all entities exist with correct relationships

## Phase 10: Final Verification
