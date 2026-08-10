# Delta for Testing — Teams Integration

## ADDED Requirements

### Requirement: Unit Tests for TeamService
The test suite MUST include comprehensive unit tests for all `TeamService` methods.

#### Scenario: TeamService Unit Test Coverage
- GIVEN the test suite is executed
- WHEN unit tests run for `TeamService`
- THEN ALL public methods MUST have test coverage:
  - `createTeam()` — platform admin creates in any org; tenant admin restricted to own org
  - `getTeamById()` — returns team with members and roles; NotFoundError for missing teams
  - `getTeamsByOrg()` — paginated list filtered by organization
  - `updateTeam()` — partial updates; slug immutability for tenant admins
  - `deleteTeam()` — platform org protection; non-empty team rejection
  - `addTeamMember()` — user must be org member first; automatic role assignment
  - `removeTeamMember()` — revokes team-inherited roles; preserves org-level roles
  - `assignTeamRole()` / `removeTeamRole()` — role must belong to same org; duplicate prevention
- THEN authorization scenarios MUST be tested: `ForbiddenError`, `NotFoundError`

#### Scenario: TeamService Test File Location
- GIVEN the test suite structure is maintained
- WHEN new unit tests are added for team features
- THEN they MUST be placed in `tests/unit/team-service.test.ts`

### Requirement: Integration Tests for Team Lifecycle
The test suite MUST include integration tests verifying team CRUD operations with a real database.

#### Scenario: Team Lifecycle Integration Tests
- GIVEN an integration test environment with PostgreSQL
- WHEN team lifecycle tests run
- THEN tests MUST verify:
  - Team creation with valid and invalid inputs
  - Team listing (paginated, filtered by organization)
  - Team update (name, description; partial updates)
  - Team deletion (empty team success; non-empty team rejection)
  - Default "Members" team bootstrapping on organization creation
- THEN tests MUST use the real Prisma client (not mocked)
- THEN tests MUST clean up created resources in `afterAll` hooks

#### Scenario: Team Lifecycle Test File Location
- GIVEN the test suite structure is maintained
- WHEN new integration tests are added for team features
- THEN they MUST be placed in `tests/integration/team-lifecycle.test.ts`

### Requirement: Integration Tests for Team Membership
The test suite MUST include integration tests verifying team membership operations.

#### Scenario: Team Membership Integration Tests
- GIVEN an integration test environment with PostgreSQL
- WHEN team membership tests run
- THEN tests MUST verify:
  - Adding a member to a team (valid org membership required)
  - Listing team members with roles
  - Removing a member from a team (role revocation)
  - Team role assignment and removal
  - Automatic role inheritance when a user joins a team with assigned roles
- THEN tests MUST use the real Prisma client (not mocked)
- THEN tests MUST clean up created resources in `afterAll` hooks

#### Scenario: Team Membership Test File Location
- GIVEN the test suite structure is maintained
- WHEN new integration tests are added for team membership features
- THEN they MUST be placed in `tests/integration/team-membership.test.ts`

### Requirement: Tenant Isolation Tests for Team Models
The test suite MUST include explicit tenant isolation tests for team-related models.

#### Scenario: Application-Layer Team Isolation Tests
- GIVEN the isolation test infrastructure is in place
- WHEN team isolation tests run
- THEN tests MUST verify:
  - A user in Organization A cannot read teams from Organization B via the tenant-scoped Prisma client
  - A user in Organization A cannot update or delete teams from Organization B
  - Team membership queries return only memberships within the active organization
- THEN tests MUST use two separate organizations and users to verify cross-org isolation

#### Scenario: Team Isolation Test File Location
- GIVEN the test suite structure is maintained
- WHEN new isolation tests are added for team features
- THEN they MUST be placed in `tests/isolation/application/team-isolation.test.ts`

### Requirement: Test Data Fixtures for Teams
The test suite MUST include fixture data for team-related testing.

#### Scenario: Team Test Fixtures
- GIVEN integration and isolation tests need pre-existing team data
- WHEN test fixtures are loaded
- THEN fixtures MUST include:
  - Two organizations (Org A and Org B) with their default "Members" teams
  - Users belonging to each organization
  - Team memberships and role assignments for testing
- THEN fixtures MUST be isolated per test to prevent cross-test leakage
