# Delta for Integrated Super Admin Dashboard — Teams

## ADDED Requirements

### Requirement: Team List API
The system MUST provide a paginated list of teams, filterable by organization.

#### Scenario: List Teams for an Organization
- GIVEN a verified Super Admin requests the team list with an `orgId` query parameter
- WHEN `GET /api/dashboard/admin/teams?orgId=[orgId]` is called
- THEN the response MUST include a paginated list of teams scoped to that organization with: id, name, slug, description, memberCount, roleCount, createdAt
- THEN the response MUST include pagination metadata: page, limit, total, totalPages

#### Scenario: List Teams — No Organization Filter
- GIVEN a Super Admin requests the team list without an `orgId` parameter
- WHEN `GET /api/dashboard/admin/teams` is called
- THEN the response MUST include teams from ALL organizations (Super Admin cross-org access)

#### Scenario: Search Teams by Name
- GIVEN a Super Admin requests the team list with a `search` query parameter
- WHEN `GET /api/dashboard/admin/teams?orgId=[orgId]&search=engineering` is called
- THEN the response MUST include teams whose name matches the search term (case-insensitive)

### Requirement: Team Detail API
The system MUST provide detailed information about a single team.

#### Scenario: Get Team Detail
- GIVEN a verified Super Admin requests a team detail
- WHEN `GET /api/dashboard/admin/teams/[id]` is called
- THEN the response MUST include: id, name, slug, description, organizationId, createdAt, updatedAt
- THEN the response MUST include related data: members (list with userId, userName, userImage), assigned roles (list with roleId, roleName)

#### Scenario: Non-Existent Team
- GIVEN a Super Admin requests a team with a non-existent ID
- WHEN `GET /api/dashboard/admin/teams/[nonExistentId]` is called
- THEN the response MUST be 404 Not Found

### Requirement: Team Create API
The system MUST support creating new teams via the dashboard.

#### Scenario: Create Team
- GIVEN a verified Super Admin sends a POST request with name, orgId, and optional description
- WHEN `POST /api/dashboard/admin/teams` is called with valid data
- THEN a new team MUST be created scoped to the specified organization
- THEN a unique slug MUST be auto-generated from the name (within the org)
- THEN the response MUST include the created team with its id

#### Scenario: Create Team — Duplicate Slug Resolution
- GIVEN a team already exists in an org with slug "engineering"
- WHEN a new team is created in the same org with name that would generate "engineering"
- THEN the system MUST append a numeric suffix (e.g., "engineering-1") to guarantee uniqueness within the org

#### Scenario: Create Team — Invalid Data
- GIVEN a Super Admin sends a POST request with an empty name or missing orgId
- WHEN `POST /api/dashboard/admin/teams` is called
- THEN the response MUST be 400 Bad Request with a validation error message

### Requirement: Team Update API
The system MUST support updating team details via the dashboard.

#### Scenario: Update Team Name and Description
- GIVEN a verified Super Admin sends a PATCH request with new name and description
- WHEN `PATCH /api/dashboard/admin/teams/[id]` is called with valid data
- THEN the team name and description MUST be updated
- THEN an audit log entry MUST be created

#### Scenario: Update Team — Non-Existent ID
- GIVEN a Super Admin sends a PATCH request for a non-existent team
- WHEN `PATCH /api/dashboard/admin/teams/[nonExistentId]` is called
- THEN the response MUST be 404 Not Found

### Requirement: Team Delete API
The system MUST support deleting teams via the dashboard.

#### Scenario: Delete Team
- GIVEN a verified Super Admin sends a DELETE request for a team
- WHEN `DELETE /api/dashboard/admin/teams/[id]` is called
- THEN the team MUST be deleted (cascading to TeamMember and TeamRole entries)
- THEN an audit log entry MUST be created

### Requirement: Team Membership Management (Team → Users Relationship)
The system MUST support adding and removing users from teams via the dashboard.

#### Scenario: List Team Members
- GIVEN a Super Admin views a team's detail modal
- WHEN the detail modal loads
- THEN it MUST display all users currently members of that team (via `TeamMember` junction table)

#### Scenario: Add User to Team
- GIVEN a Super Admin opens the member assignment multi-select in the team detail modal
- WHEN they select one or more users and confirm
- THEN `TeamMember` entries MUST be created linking each selected user to the team (scoped to the organization)
- THEN the added members MUST be reflected in subsequent detail modal views

#### Scenario: Remove User from Team
- GIVEN a team has members
- WHEN a Super Admin removes a user via the detail modal
- THEN the corresponding `TeamMember` entry MUST be deleted
- THEN the user MUST no longer appear in the team's member list

#### Scenario: User Can Be in Multiple Teams
- GIVEN a user is already a member of Team A within an organization
- WHEN the same user is added to Team B within the same organization
- THEN the user MUST have two separate `TeamMember` entries (one per team)
- THEN the user MUST appear in both teams' member lists

### Requirement: Team Role Inheritance (Team → Default Roles Relationship)
The system MUST support assigning and revoking default roles to teams via the dashboard.

#### Scenario: List Team Assigned Roles
- GIVEN a Super Admin views a team's detail modal
- WHEN the detail modal loads
- THEN it MUST display all roles currently assigned to that team (via `TeamRole` junction table)

#### Scenario: Assign Role to Team
- GIVEN a Super Admin opens the role assignment multi-select in the team detail modal
- WHEN they select one or more roles and confirm
- THEN `TeamRole` entries MUST be created linking each selected role to the team (scoped to the organization)
- THEN the assigned roles MUST be reflected in subsequent detail modal views

#### Scenario: Revoke Role from Team
- GIVEN a team has assigned roles
- WHEN a Super Admin revokes a role via the detail modal
- THEN the corresponding `TeamRole` entry MUST be deleted
- THEN the role MUST no longer appear in the team's assigned roles

#### Scenario: Role Inheritance on Team Membership
- GIVEN a team has roles R1 and R2 assigned via `TeamRole`
- WHEN a user is added to that team via `TeamMember`
- THEN the user MUST automatically inherit roles R1 and R2 (via `MemberRole` entries)
- THEN this inheritance MUST be reflected in the user's assigned roles

#### Scenario: Role Inheritance Revocation on Team Membership Removal
- GIVEN a user has inherited roles R1 and R2 from team membership
- WHEN the user is removed from that team
- THEN the inherited `MemberRole` entries for R1 and R2 (created by team inheritance) MUST be removed
- THEN the user MUST no longer have those roles
