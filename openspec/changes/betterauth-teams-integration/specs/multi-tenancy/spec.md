# Delta for Multi-Tenancy & Tenant Isolation — Teams Integration

## ADDED Requirements

### Requirement: Team Models in Prisma Extension Scoping
The tenant-scoped Prisma extension MUST automatically scope all queries on team-related models to the current organization.

#### Scenario: Team Query Scoping
- GIVEN the tenant-scoped Prisma client is in use (`lib/tenant-db.ts`)
- WHEN a query is executed on the `Team` model (e.g., `findMany`, `findFirst`)
- THEN the Prisma extension MUST automatically inject `organizationId: <currentOrgId>` into the query
- THEN queries on `TeamMember` and `TeamRole` MUST also be automatically scoped

#### Scenario: Team Models in Exempt List
- GIVEN the Prisma extension's exempt models list is maintained
- WHEN new org-scoped models are added
- THEN `Team`, `TeamMember`, and `TeamRole` MUST be included in the exempt list (they are org-scoped, not global)
- THEN they MUST NOT be treated as global models

### Requirement: PostgreSQL RLS for Team Models
PostgreSQL Row Level Security MUST be enabled on all team-related tables.

#### Scenario: RLS Enablement for Team Tables
- GIVEN the migration for team models is applied
- WHEN RLS policies are created
- THEN `ALTER TABLE "Team" ENABLE ROW LEVEL SECURITY;` MUST be executed
- THEN `ALTER TABLE "TeamMember" ENABLE ROW LEVEL SECURITY;` MUST be executed
- THEN `ALTER TABLE "TeamRole" ENABLE ROW LEVEL SECURITY;` MUST be executed

#### Scenario: RLS Policy for Team Tables
- GIVEN RLS is enabled on a team table
- WHEN a query is executed against that table
- THEN the RLS policy MUST filter rows by `organizationId::text = current_setting('app.current_org_id', true)`
- THEN the policy MUST apply to all operations (SELECT, INSERT, UPDATE, DELETE)

#### Scenario: RLS Policy Template for New Team Tables
- GIVEN a new migration adds team-related tables
- WHEN the migration is written
- THEN it MUST include RLS enablement and policy creation for each new table
- THEN the migration MUST include comments explaining how to verify RLS is working

### Requirement: Cross-Tenant Team Data Isolation
No user may access team data from another organization, under any circumstances.

#### Scenario: Application-Layer Cross-Tenant Prevention
- GIVEN a user belongs to Organization A
- WHEN they attempt to read, update, or delete a team belonging to Organization B
- THEN the Prisma extension MUST reject the query (organization ID mismatch)
- THEN no team data from Organization B MUST be returned

#### Scenario: Database-Layer Cross-Tenant Prevention
- GIVEN the Prisma extension is bypassed (e.g., raw SQL query)
- WHEN a query attempts to access team data from another organization
- THEN PostgreSQL RLS MUST block the query
- THEN no team data from Organization B MUST be returned

### Requirement: Team Membership Isolation
A user's team memberships in one organization must not leak to another.

#### Scenario: Team Membership Query Scoping
- GIVEN a user is a member of teams in Organization A
- WHEN their team memberships are queried for Organization B
- THEN the query MUST return zero results (the user has no team memberships in Organization B)
- THEN this MUST hold at both the application layer (Prisma extension) and database layer (RLS)

### Requirement: Tenant Isolation Testing for Team Models
The test suite MUST include explicit tests verifying tenant isolation for team-related models.

#### Scenario: Application-Layer Team Isolation Tests
- GIVEN the test suite is executed
- WHEN team isolation tests run
- THEN tests MUST verify that a user in Organization A cannot read, update, or delete teams from Organization B
- THEN tests MUST verify that team membership queries are correctly scoped to the active organization
- THEN these tests MUST be organized in `tests/isolation/application/team-isolation.test.ts`

#### Scenario: Database-Layer Team Isolation Tests
- GIVEN the test suite is executed
- WHEN team RLS isolation tests run
- THEN tests MUST execute raw SQL queries attempting cross-org team access
- THEN tests MUST verify that RLS blocks these queries even when application-layer scoping is bypassed
- THEN these tests MUST be organized in `tests/isolation/database/` (or co-located with application tests)
