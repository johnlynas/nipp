# Delta for Integrated Super Admin Dashboard — Users

## ADDED Requirements

### Requirement: User List API
The system MUST provide a paginated list of all users accessible to Super Admins.

#### Scenario: List Users
- GIVEN a verified Super Admin requests the user list
- WHEN `GET /api/dashboard/admin/users` is called
- THEN the response MUST include a paginated list of users with: id, name, email, emailVerified, image, role, banned, banReason, createdAt, lastActiveAt
- THEN the response MUST include pagination metadata: page, limit, total, totalPages

#### Scenario: Search Users by Name or Email
- GIVEN a Super Admin requests the user list with a `search` query parameter
- WHEN `GET /api/dashboard/admin/users?search=alice` is called
- THEN the response MUST include users whose name or email matches the search term (case-insensitive)

#### Scenario: Filter Users by Ban Status
- GIVEN a Super Admin requests the user list with a `banned` query parameter
- WHEN `GET /api/dashboard/admin/users?banned=true` is called
- THEN the response MUST include only banned users

#### Scenario: Filter Users by Email Verification Status
- GIVEN a Super Admin requests the user list with an `emailVerified` query parameter
- WHEN `GET /api/dashboard/admin/users?emailVerified=false` is called
- THEN the response MUST include only unverified users

### Requirement: User Detail API
The system MUST provide detailed information about a single user.

#### Scenario: Get User Detail
- GIVEN a verified Super Admin requests a user detail
- WHEN `GET /api/dashboard/admin/users/[id]` is called
- THEN the response MUST include: id, name, email, emailVerified, image, role, banned, banReason, createdAt
- THEN the response MUST include related data: assigned roles (list of role names), organization memberships (list with orgName, memberRole)

#### Scenario: Non-Existent User
- GIVEN a Super Admin requests a user with a non-existent ID
- WHEN `GET /api/dashboard/admin/users/[nonExistentId]` is called
- THEN the response MUST be 404 Not Found

### Requirement: User Create API
The system MUST support creating new users via the dashboard.

#### Scenario: Create User
- GIVEN a verified Super Admin sends a POST request with name and email
- WHEN `POST /api/dashboard/admin/users` is called with valid data
- THEN a new user MUST be created
- THEN the response MUST include the created user with its id

#### Scenario: Create User — Duplicate Email
- GIVEN a user already exists with email "alice@example.com"
- WHEN a Super Admin attempts to create another user with the same email
- THEN the response MUST be 409 Conflict (or 400 with validation error)

### Requirement: User Update API
The system MUST support updating user details via the dashboard.

#### Scenario: Update User Name
- GIVEN a verified Super Admin sends a PATCH request with a new name
- WHEN `PATCH /api/dashboard/admin/users/[id]` is called with valid data
- THEN the user name MUST be updated

#### Scenario: Update User — Non-Existent ID
- GIVEN a Super Admin sends a PATCH request for a non-existent user
- WHEN `PATCH /api/dashboard/admin/users/[nonExistentId]` is called
- THEN the response MUST be 404 Not Found

### Requirement: User Ban/Unban API
The system MUST support banning and unbanning users via the dashboard.

#### Scenario: Ban User
- GIVEN a verified Super Admin sends a POST request to ban a user
- WHEN `POST /api/dashboard/admin/users/[id]/ban` is called with `{ banned: true, banReason?: string }`
- THEN the user's `banned` field MUST be set to true
- THEN an optional `banReason` MAY be recorded

#### Scenario: Unban User
- GIVEN a banned user
- WHEN a Super Admin sends a POST request to unban the user
- WHEN `POST /api/dashboard/admin/users/[id]/ban` is called with `{ banned: false }`
- THEN the user's `banned` field MUST be set to false

#### Scenario: Ban User — Invalid Data
- GIVEN a Super Admin sends a POST request without the `banned` field
- WHEN `POST /api/dashboard/admin/users/[id]/ban` is called
- THEN the response MUST be 400 Bad Request with a validation error message

### Requirement: User Delete API
The system MUST support deleting users via the dashboard.

#### Scenario: Delete User
- GIVEN a verified Super Admin sends a DELETE request for a user
- WHEN `DELETE /api/dashboard/admin/users/[id]` is called
- THEN the user MUST be deleted from the database (cascading to sessions, accounts, members)
- THEN an audit log entry MUST be created

### Requirement: User Role Assignment (Relationship)
The system MUST support assigning roles to users via the dashboard.

#### Scenario: View User Assigned Roles
- GIVEN a Super Admin views a user's detail modal
- WHEN the detail modal loads
- THEN it MUST display all roles currently assigned to that user (via `MemberRole` junction table)

#### Scenario: Assign Role to User
- GIVEN a Super Admin opens the role assignment multi-select in the user detail modal
- WHEN they select one or more roles and confirm
- THEN `MemberRole` entries MUST be created linking the user to each selected role (scoped to the appropriate organization)
- THEN the assigned roles MUST be reflected in subsequent detail modal views

#### Scenario: Remove Role from User
- GIVEN a user has assigned roles
- WHEN a Super Admin removes a role via the detail modal
- THEN the corresponding `MemberRole` entry MUST be deleted
- THEN the role MUST no longer appear in the user's assigned roles
