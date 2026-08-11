# Delta for Integrated Super Admin Dashboard — Organizations

## ADDED Requirements

### Requirement: Organization List API
The system MUST provide a paginated list of all organizations accessible to Super Admins.

#### Scenario: List Organizations
- GIVEN a verified Super Admin requests the organization list
- WHEN `GET /api/dashboard/admin/organizations` is called
- THEN the response MUST include a paginated list of organizations with: id, name, slug, status, memberCount, teamCount, createdAt
- THEN the response MUST include pagination metadata: page, limit, total, totalPages
- THEN the default page size MUST be 20

#### Scenario: Search Organizations by Name
- GIVEN a Super Admin requests the organization list with a `search` query parameter
- WHEN `GET /api/dashboard/admin/organizations?search=acme` is called
- THEN the response MUST include organizations whose name or slug matches the search term (case-insensitive)

#### Scenario: Filter Organizations by Status
- GIVEN a Super Admin requests the organization list with a `status` query parameter
- WHEN `GET /api/dashboard/admin/organizations?status=active` is called
- THEN the response MUST include only organizations with status matching the filter

#### Scenario: Non-Super-Admin Cannot List Organizations
- GIVEN a non-Super-Admin user requests the organization list
- WHEN `GET /api/dashboard/admin/organizations` is called
- THEN the response MUST be 403 Forbidden

### Requirement: Organization Detail API
The system MUST provide detailed information about a single organization.

#### Scenario: Get Organization Detail
- GIVEN a verified Super Admin requests an organization detail
- WHEN `GET /api/dashboard/admin/organizations/[id]` is called
- THEN the response MUST include: id, name, slug, status, metadata, createdAt, updatedAt
- THEN the response MUST include related data: members (list with userId, userName, role), teams (list with id, name, memberCount)

#### Scenario: Non-Existent Organization
- GIVEN a Super Admin requests an organization with a non-existent ID
- WHEN `GET /api/dashboard/admin/organizations/[nonExistentId]` is called
- THEN the response MUST be 404 Not Found

### Requirement: Organization Create API
The system MUST support creating new organizations via the dashboard.

#### Scenario: Create Organization
- GIVEN a verified Super Admin sends a POST request with name and initial admin email
- WHEN `POST /api/dashboard/admin/organizations` is called with valid data
- THEN a new organization MUST be created with status PENDING
- THEN a unique slug MUST be auto-generated from the name
- THEN `org-bootstrap.ts` MUST automatically create the 7 default roles for the new organization
- THEN the response MUST include the created organization with its id

#### Scenario: Create Organization — Duplicate Slug Resolution
- GIVEN an organization already exists with slug "acme-corp"
- WHEN a new organization is created with name "Acme Corp" (which would generate the same slug)
- THEN the system MUST append a numeric suffix (e.g., "acme-corp-1") to guarantee uniqueness

#### Scenario: Create Organization — Invalid Data
- GIVEN a Super Admin sends a POST request with an empty name
- WHEN `POST /api/dashboard/admin/organizations` is called
- THEN the response MUST be 400 Bad Request with a validation error message

### Requirement: Organization Update API
The system MUST support updating organization details via the dashboard.

#### Scenario: Update Organization Name
- GIVEN a verified Super Admin sends a PATCH request with a new name
- WHEN `PATCH /api/dashboard/admin/organizations/[id]` is called with valid data
- THEN the organization name MUST be updated
- THEN an audit log entry MUST be created

#### Scenario: Update Organization — Non-Existent ID
- GIVEN a Super Admin sends a PATCH request for a non-existent organization
- WHEN `PATCH /api/dashboard/admin/organizations/[nonExistentId]` is called
- THEN the response MUST be 404 Not Found

### Requirement: Organization Status Transition API
The system MUST support transitioning organization lifecycle states via the dashboard.

#### Scenario: Activate Organization (PENDING → ACTIVE)
- GIVEN an organization is in PENDING state
- WHEN a Super Admin transitions it to ACTIVE
- THEN the status MUST change to ACTIVE
- THEN an audit log entry MUST be created

#### Scenario: Suspend Organization (ACTIVE → SUSPENDED)
- GIVEN an organization is in ACTIVE state
- WHEN a Super Admin transitions it to SUSPENDED
- THEN the status MUST change to SUSPENDED
- THEN all active sessions for members of that organization MUST be invalidated
- THEN an audit log entry MUST be created

#### Scenario: Archive Organization (ACTIVE/SUSPENDED → ARCHIVED)
- GIVEN an organization is in ACTIVE or SUSPENDED state
- WHEN a Super Admin transitions it to ARCHIVED
- THEN the status MUST change to ARCHIVED
- THEN this state MUST be terminal (no further transitions allowed)

#### Scenario: Invalid State Transition
- GIVEN an organization is in ARCHIVED state
- WHEN any user attempts to change its status
- THEN the system MUST reject the request with a 400 Bad Request error

### Requirement: Organization Delete (Archive) API
The system MUST support archiving organizations via the dashboard.

#### Scenario: Archive Organization via Delete Action
- GIVEN a verified Super Admin sends a DELETE request for an organization
- WHEN `DELETE /api/dashboard/admin/organizations/[id]` is called
- THEN the organization status MUST transition to ARCHIVED (hard delete is deferred)
- THEN an audit log entry MUST be created
