# Delta for Integrated Super Admin Dashboard — Roles & Permissions

## ADDED Requirements

### Requirement: Role List API
The system MUST provide a paginated list of roles, filterable by organization.

#### Scenario: List Roles for an Organization
- GIVEN a verified Super Admin requests the role list with an `orgId` query parameter
- WHEN `GET /api/dashboard/admin/roles?orgId=[orgId]` is called
- THEN the response MUST include a paginated list of roles scoped to that organization with: id, name, description, isDefault, permissionCount, memberCount, createdAt
- THEN the response MUST include pagination metadata: page, limit, total, totalPages

#### Scenario: List Roles — No Organization Filter
- GIVEN a Super Admin requests the role list without an `orgId` parameter
- WHEN `GET /api/dashboard/admin/roles` is called
- THEN the response MUST include roles from ALL organizations (Super Admin cross-org access)

#### Scenario: Search Roles by Name
- GIVEN a Super Admin requests the role list with a `search` query parameter
- WHEN `GET /api/dashboard/admin/roles?orgId=[orgId]&search=admin` is called
- THEN the response MUST include roles whose name matches the search term (case-insensitive)

#### Scenario: Filter Roles by Type
- GIVEN a Super Admin requests the role list with an `isDefault` query parameter
- WHEN `GET /api/dashboard/admin/roles?orgId=[orgId]&isDefault=true` is called
- THEN the response MUST include only default roles (bootstrapped)

### Requirement: Role Detail API
The system MUST provide detailed information about a single role.

#### Scenario: Get Role Detail
- GIVEN a verified Super Admin requests a role detail
- WHEN `GET /api/dashboard/admin/roles/[id]` is called
- THEN the response MUST include: id, name, description, isDefault, organizationId, createdAt, updatedAt
- THEN the response MUST include related data: assigned permissions (list with permissionId, key, resource, action), assigned members (list with userId, userName)

#### Scenario: Non-Existent Role
- GIVEN a Super Admin requests a role with a non-existent ID
- WHEN `GET /api/dashboard/admin/roles/[nonExistentId]` is called
- THEN the response MUST be 404 Not Found

### Requirement: Role Create API
The system MUST support creating new roles via the dashboard.

#### Scenario: Create Role
- GIVEN a verified Super Admin sends a POST request with name, orgId, and optional description
- WHEN `POST /api/dashboard/admin/roles` is called with valid data
- THEN a new role MUST be created scoped to the specified organization
- THEN `isDefault` MUST be false (custom role)
- THEN the response MUST include the created role with its id

#### Scenario: Create Role — Duplicate Name in Same Org
- GIVEN a role already exists in an org with name "Property Manager"
- WHEN a Super Admin attempts to create another role with the same name in the same org
- THEN the response MUST be 409 Conflict (or 400 with validation error)

#### Scenario: Create Role — Invalid Data
- GIVEN a Super Admin sends a POST request with an empty name or missing orgId
- WHEN `POST /api/dashboard/admin/roles` is called
- THEN the response MUST be 400 Bad Request with a validation error message

### Requirement: Role Update API
The system MUST support updating role details via the dashboard.

#### Scenario: Update Role Name and Description
- GIVEN a verified Super Admin sends a PATCH request with new name and description
- WHEN `PATCH /api/dashboard/admin/roles/[id]` is called with valid data
- THEN the role name and description MUST be updated
- THEN Redis permission cache MUST be invalidated for the affected organization
- THEN an audit log entry MUST be created

#### Scenario: Update Role — Non-Existent ID
- GIVEN a Super Admin sends a PATCH request for a non-existent role
- WHEN `PATCH /api/dashboard/admin/roles/[nonExistentId]` is called
- THEN the response MUST be 404 Not Found

### Requirement: Role Delete API with Safety Check
The system MUST support deleting roles via the dashboard, with safety checks.

#### Scenario: Delete Role With No Assignments
- GIVEN a verified Super Admin sends a DELETE request for a role with no members and no permissions assigned
- WHEN `DELETE /api/dashboard/admin/roles/[id]` is called
- THEN the role MUST be deleted
- THEN Redis permission cache MUST be invalidated for the affected organization

#### Scenario: Delete Role With Members Assigned
- GIVEN a role has one or more members assigned via `MemberRole`
- WHEN a Super Admin sends a DELETE request for that role
- THEN the response MUST be 400 Bad Request with a warning message including the count of affected members
- THEN the role MUST NOT be deleted

#### Scenario: Delete Role With Permissions Assigned
- GIVEN a role has one or more permissions assigned via `RolePermission`
- WHEN a Super Admin sends a DELETE request for that role
- THEN the response MUST be 400 Bad Request with a warning message including the count of assigned permissions
- THEN the role MUST NOT be deleted

### Requirement: Permission Assignment to Role (Role ↔ Permissions Relationship)
The system MUST support assigning and revoking permissions to roles via the dashboard.

#### Scenario: List Role Assigned Permissions
- GIVEN a Super Admin views a role's detail modal
- WHEN the detail modal loads
- THEN it MUST display all permissions currently assigned to that role (via `RolePermission` junction table)

#### Scenario: Assign Permission to Role
- GIVEN a Super Admin opens the permission assignment multi-select in the role detail modal
- WHEN they select one or more permissions and confirm
- THEN `RolePermission` entries MUST be created linking each selected permission to the role (scoped to the organization)
- THEN Redis permission cache MUST be invalidated for the affected organization
- THEN the assigned permissions MUST be reflected in subsequent detail modal views

#### Scenario: Revoke Permission from Role
- GIVEN a role has assigned permissions
- WHEN a Super Admin revokes a permission via the detail modal
- THEN the corresponding `RolePermission` entry MUST be deleted
- THEN Redis permission cache MUST be invalidated for the affected organization
- THEN the permission MUST no longer appear in the role's assigned permissions

#### Scenario: Permission Must Exist in Global Catalog
- GIVEN a Super Admin attempts to assign a permission to a role
- WHEN the specified permission ID does not exist in the global `Permission` catalog
- THEN the response MUST be 404 Not Found

### Requirement: Permission List API (Global Catalog)
The system MUST provide a list of all permissions in the global catalog.

#### Scenario: List All Permissions
- GIVEN a verified Super Admin requests the permission list
- WHEN `GET /api/dashboard/admin/permissions` is called
- THEN the response MUST include all permissions from the global `Permission` model with: id, key, resource, action, description
- THEN the response MUST include pagination metadata: page, limit, total, totalPages

#### Scenario: Search Permissions by Key, Resource, or Action
- GIVEN a Super Admin requests the permission list with a `search` query parameter
- WHEN `GET /api/dashboard/admin/permissions?search=properties` is called
- THEN the response MUST include permissions whose key, resource, or action matches the search term (case-insensitive)

#### Scenario: Filter Permissions by Resource
- GIVEN a Super Admin requests the permission list with a `resource` query parameter
- WHEN `GET /api/dashboard/admin/permissions?resource=properties` is called
- THEN the response MUST include only permissions where the resource matches the filter

### Requirement: Permission Create API
The system MUST support creating new permissions in the global catalog via the dashboard.

#### Scenario: Create Permission
- GIVEN a verified Super Admin sends a POST request with key (resource:action format), resource, action, and optional description
- WHEN `POST /api/dashboard/admin/permissions` is called with valid data
- THEN a new permission MUST be created in the global `Permission` model
- THEN the key MUST follow the `resource:action` syntax (e.g., "properties:view")
- THEN the response MUST include the created permission with its id

#### Scenario: Create Permission — Duplicate Key
- GIVEN a permission already exists with key "properties:view"
- WHEN a Super Admin attempts to create another permission with the same key
- THEN the response MUST be 409 Conflict (or 400 with validation error)

#### Scenario: Create Permission — Invalid Key Format
- GIVEN a Super Admin sends a POST request with a key that does not follow `resource:action` format
- WHEN `POST /api/dashboard/admin/permissions` is called
- THEN the response MUST be 400 Bad Request with a validation error message

### Requirement: Permission Update API
The system MUST support updating permissions in the global catalog via the dashboard.

#### Scenario: Update Permission Description
- GIVEN a verified Super Admin sends a PATCH request with a new description
- WHEN `PATCH /api/dashboard/admin/permissions/[id]` is called with valid data
- THEN the permission description MUST be updated
- THEN Redis permission cache MUST be invalidated for ALL organizations (since permissions are global)

#### Scenario: Update Permission — Non-Existent ID
- GIVEN a Super Admin sends a PATCH request for a non-existent permission
- WHEN `PATCH /api/dashboard/admin/permissions/[nonExistentId]` is called
- THEN the response MUST be 404 Not Found

### Requirement: Permission Delete API with Safety Check
The system MUST support deleting permissions via the dashboard, with safety checks.

#### Scenario: Delete Permission With No Role Assignments
- GIVEN a permission is not assigned to any role via `RolePermission`
- WHEN a Super Admin sends a DELETE request for that permission
- THEN the permission MUST be deleted from the global catalog
- THEN Redis permission cache MUST be invalidated for ALL organizations

#### Scenario: Delete Permission With Role Assignments
- GIVEN a permission is assigned to one or more roles via `RolePermission`
- WHEN a Super Admin sends a DELETE request for that permission
- THEN the response MUST be 400 Bad Request with a warning message including the count of roles using this permission
- THEN the permission MUST NOT be deleted

### Requirement: Role Member Count (Read-Only)
The system MUST provide the count of members assigned to each role.

#### Scenario: Role Member Count in List View
- GIVEN a Super Admin views the roles list
- WHEN the role list is rendered
- THEN each row MUST show the count of members assigned to that role (via `MemberRole` junction table)

#### Scenario: Role Member Count in Detail View
- GIVEN a Super Admin views a role's detail modal
- WHEN the detail modal loads
- THEN it MUST display a list of all members assigned to that role (userId, userName)
