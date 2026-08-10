# Delta for Database — Teams Integration

## ADDED Requirements

### Requirement: Team Model
The system MUST include a `Team` model representing functional groupings within an organization.

#### Scenario: Team Schema Definition
- GIVEN the Prisma schema is being updated
- WHEN the `Team` model is defined
- THEN it MUST include:
  - `id String @id @default(cuid())` — unique identifier
  - `name String` — human-readable team name (required, max 100 chars)
  - `slug String? @unique` — URL-friendly identifier (auto-generated from name if not provided)
  - `description String?` — optional team description (max 500 chars)
  - `organizationId String` — foreign key to Organization
  - `organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)`
  - `createdAt DateTime @default(now())`
  - `updatedAt DateTime @updatedAt`
- THEN the model MUST have a B-tree index on `[organizationId, name]` for efficient org-scoped team lookups
- THEN the model MUST have a B-tree index on `slug` for unique slug resolution

### Requirement: TeamMember Model
The system MUST include a `TeamMember` model representing user-to-team membership.

#### Scenario: TeamMember Schema Definition
- GIVEN the Prisma schema is being updated
- WHEN the `TeamMember` model is defined
- THEN it MUST include:
  - `id String @id @default(cuid())` — unique identifier
  - `teamId String` — foreign key to Team
  - `team Team @relation(fields: [teamId], references: [id], onDelete: Cascade)`
  - `userId String` — foreign key to User
  - `user User @relation(fields: [userId], references: [id], onDelete: Cascade)`
  - `organizationId String` — foreign key to Organization (for tenant isolation)
  - `organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)`
  - `createdAt DateTime @default(now())`
- THEN the model MUST have a unique constraint on `[userId, teamId]` — a user can only be in a team once
- THEN the model MUST have an index on `[organizationId]` for tenant-scoped queries
- THEN the model MUST have an index on `[teamId]` for team member lookups

### Requirement: TeamRole Model
The system MUST include a `TeamRole` model linking teams to organization-scoped roles for automatic role inheritance.

#### Scenario: TeamRole Schema Definition
- GIVEN the Prisma schema is being updated
- WHEN the `TeamRole` model is defined
- THEN it MUST include:
  - `id String @id @default(cuid())` — unique identifier
  - `teamId String` — foreign key to Team
  - `team Team @relation(fields: [teamId], references: [id], onDelete: Cascade)`
  - `roleId String` — foreign key to Role
  - `role Role @relation(fields: [roleId], references: [id], onDelete: Cascade)`
  - `organizationId String` — foreign key to Organization (for tenant isolation)
  - `organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)`
  - `createdAt DateTime @default(now())`
- THEN the model MUST have a unique constraint on `[teamId, roleId]` — a role can only be assigned once per team
- THEN the model MUST have an index on `[organizationId]` for tenant-scoped queries

### Requirement: Invitation Team Association
The `Invitation` model MUST support optional team association.

#### Scenario: Invitation teamId Field
- GIVEN the Prisma schema is being updated
- WHEN the `Invitation` model is modified
- THEN an optional `teamId String? @map("teamId")` field MUST be added
- THEN the field is nullable — invitations without a team target the organization generally

### Requirement: Member Team Association
The `Member` model MUST support optional team association (BetterAuth internal alignment).

#### Scenario: Member teamId Field
- GIVEN the Prisma schema is being updated
- WHEN the `Member` model is modified
- THEN an optional `teamId String? @map("teamId")` field MUST be added
- THEN the field is nullable — organization members without a team belong to the default "Members" team

### Requirement: Default Members Team Bootstrap
Every new organization MUST be bootstrapped with a default team named "Members".

#### Scenario: Default Team on Organization Creation
- GIVEN a new organization is created (via `OrganizationService.createOrganization` or BetterAuth)
- WHEN the organization creation transaction completes
- THEN a `Team` record MUST be created with:
  - `name = "Members"`
  - `slug = "members"`
  - `organizationId` set to the new organization's ID
- THEN all members added to the organization during creation MUST be automatically added to this default team

### Requirement: Tenant Isolation on Team Models
All team-related models MUST be organization-scoped for tenant isolation.

#### Scenario: Organization ID on Team Models
- GIVEN the `Team`, `TeamMember`, and `TeamRole` models are defined
- WHEN tenant isolation is evaluated
- THEN each model MUST include a non-optional `organizationId` field
- THEN each model MUST have a relation to the `Organization` model with `onDelete: Cascade`
- THEN each model MUST have an index on `[organizationId]`

### Requirement: Foreign Key Cascade Behavior
Team-related models MUST use cascade delete to maintain referential integrity.

#### Scenario: Cascade Delete on Team Deletion
- GIVEN a team has members and role assignments
- WHEN the team is deleted
- THEN all `TeamMember` records for that team MUST be cascade-deleted
- THEN all `TeamRole` records for that team MUST be cascade-deleted

#### Scenario: Cascade Delete on Organization Deletion
- GIVEN an organization has teams
- WHEN the organization is deleted
- THEN all `Team` records for that organization MUST be cascade-deleted
- THEN all associated `TeamMember` and `TeamRole` records are cascade-deleted transitively

### Requirement: Developer Profile Seeding
The Prisma seed script MUST create a complete developer-ready environment with platform and tenant profiles, including teams.

#### Scenario: Developer Platform Profile
- GIVEN the seed script runs in dev mode (default)
- WHEN seeding completes
- THEN a team named "Platform Ops" MUST exist in the Platform organization
- THEN the platform user (from `ADMIN_EMAIL`) MUST be a member of the "Platform Ops" team via a `TeamMember` record
- THEN the platform user MUST have their existing Super Admin role and member records preserved

#### Scenario: Developer Tenant Profile
- GIVEN the seed script runs in dev mode (default)
- WHEN seeding completes
- THEN a tenant organization named "Dev Tenant Ltd" (slug: `dev-tenant-ltd`) MUST exist with status ACTIVE
- THEN a default "Members" team AND an "Operations" team MUST exist in the dev tenant organization
- THEN two tenant users MUST be created:
  - Tenant User A: email from `DEV_TENANT_A_EMAIL` (default: `dev-tenant-a@example.com`), password from `DEV_TENANT_A_PASSWORD`
  - Tenant User B: email from `DEV_TENANT_B_EMAIL` (default: `dev-tenant-b@example.com`), password from `DEV_TENANT_B_PASSWORD`
- THEN both tenant users MUST have credential accounts with hashed passwords
- THEN both tenant users MUST be members of the dev tenant organization
- THEN both tenant users MUST be added to the "Operations" team via `TeamMember` records
- THEN both tenant users MUST be assigned default organization roles via `MemberRole` records

#### Scenario: Developer Profile Idempotency
- GIVEN the seed script has already been run and created developer profile entities
- WHEN the seed script runs again
- THEN existing Platform organization, teams, and users MUST NOT be duplicated (upsert behavior)
- THEN existing tenant organizations, teams, and users MUST NOT be duplicated (upsert behavior)
- THEN passwords MUST be updated if the `.env` values have changed

### Requirement: Testing Profile Seeding
The Prisma seed script MUST create a complete test-ready environment with platform and tenant profiles, including teams. This is separate from the developer profile to avoid test interference.

#### Scenario: Testing Platform Profile
- GIVEN the seed script runs in test mode (`TEST_ADMIN_EMAIL` is set)
- WHEN seeding completes
- THEN a team named "Platform Ops" MUST exist in the Platform organization
- THEN the platform test user (from `TEST_ADMIN_EMAIL`) MUST be a member of the "Platform Ops" team via a `TeamMember` record
- THEN the platform test user MUST have their Super Admin role and member records created/updated

#### Scenario: Testing Tenant Profile
- GIVEN the seed script runs in test mode (`TEST_ADMIN_EMAIL` is set)
- WHEN seeding completes
- THEN a tenant organization named "Test Tenant Ltd" (slug: `test-tenant-ltd`) MUST exist with status ACTIVE
- THEN a default "Members" team AND a "QA Operations" team MUST exist in the test tenant organization
- THEN two tenant users MUST be created:
  - Test Tenant User A: email from `TEST_TENANT_A_EMAIL` (default: `test-tenant-a@example.com`), password from `TEST_TENANT_A_PASSWORD`
  - Test Tenant User B: email from `TEST_TENANT_B_EMAIL` (default: `test-tenant-b@example.com`), password from `TEST_TENANT_B_PASSWORD`
- THEN both test tenant users MUST have credential accounts with hashed passwords
- THEN both test tenant users MUST be members of the test tenant organization
- THEN both test tenant users MUST be added to the "QA Operations" team via `TeamMember` records
- THEN both test tenant users MUST be assigned default organization roles via `MemberRole` records

#### Scenario: Testing Profile Idempotency
- GIVEN the seed script has already been run and created testing profile entities
- WHEN the seed script runs again in test mode
- THEN existing Platform organization, teams, and users MUST NOT be duplicated (upsert behavior)
- THEN existing tenant organizations, teams, and users MUST NOT be duplicated (upsert behavior)
- THEN passwords MUST be updated if the `TEST_*` env values have changed

#### Scenario: Seeding Mode Detection
- GIVEN the seed script runs
- WHEN `TEST_ADMIN_EMAIL` is set in the environment
- THEN the seed script MUST create the testing profile (not the developer profile)
- WHEN `TEST_ADMIN_EMAIL` is NOT set
- THEN the seed script MUST create the developer profile (default behavior)
- THEN both modes MUST create default "Members" teams on all organizations
