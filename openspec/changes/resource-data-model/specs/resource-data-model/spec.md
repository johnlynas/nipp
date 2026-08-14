# Delta for Resource Data Model — Schema, Service & API

## ADDED Requirements

### Requirement: Resource Data Model
The system MUST define a global `Resource` data model representing portal feature modules.

#### Scenario: Resource Model Structure
- GIVEN the Prisma schema is validated
- THEN a `Resource` model MUST exist with fields: `id` (cuid, primary key), `name` (string, unique), `description` (string, nullable), `createdAt` (datetime, default now()), `updatedAt` (datetime, updatedAt)
- THEN the `Resource` model MUST NOT have an `organizationId` field (it is a global model)

#### Scenario: ResourceRole Junction Model
- GIVEN the Prisma schema is validated
- THEN a `ResourceRole` model MUST exist with fields: `id` (cuid, primary key), `resourceId` (string, foreign key to Resource), `roleId` (string, foreign key to Role), `createdAt` (datetime, default now())
- THEN `ResourceRole` MUST have a unique constraint on `[resourceId, roleId]` (a role can only be assigned once per resource)
- THEN `ResourceRole.resourceId` MUST reference `Resource.id` with `onDelete: Cascade`
- THEN `ResourceRole.roleId` MUST reference `Role.id` with `onDelete: Cascade`
- THEN the `ResourceRole` model MUST NOT have an `organizationId` field (it is a global model)

#### Scenario: Role Model Relation to Resources
- GIVEN the Prisma schema is validated
- THEN the `Role` model MUST have a relation field: `resources ResourceRole[]` (back-referencing the global junction table)

#### Scenario: Organization Model Relation to Resources
- GIVEN the Prisma schema is validated
- THEN the `Organization` model MUST have a relation field: `resourceRoles ResourceRole[]` (back-referencing the global junction table)

### Requirement: ResourceService — Create
The system MUST provide a `ResourceService.create()` method for creating new resources.

#### Scenario: Create Resource — Platform Admin
- GIVEN a verified Super Admin (PLATFORM_ADMIN role) calls `ResourceService.create()` with `{ name: "Maintenance", description: "Manage maintenance requests" }`
- WHEN the service executes
- THEN a new `Resource` record MUST be created in the database with the provided name and description
- THEN the response MUST include the created resource object with its generated `id`

#### Scenario: Create Resource — Platform Admin with Role Assignments
- GIVEN a verified Super Admin calls `ResourceService.create()` with `{ name: "Maintenance", description: "...", roleIds: ["role_1", "role_2"] }`
- WHEN the service executes
- THEN a new `Resource` record MUST be created
- THEN `ResourceRole` junction records MUST be created linking the resource to each specified role
- THEN the operation MUST use a database transaction (atomic: both succeed or both fail)

#### Scenario: Create Resource — Non-Platform Admin Denied
- GIVEN a user with TENANT_ADMIN role calls `ResourceService.create()`
- WHEN the service executes
- THEN a `ForbiddenError` MUST be thrown with message "Platform Admin access required"

#### Scenario: Create Resource — Member Denied
- GIVEN a user with MEMBER role calls `ResourceService.create()`
- WHEN the service executes
- THEN a `ForbiddenError` MUST be thrown with message "Platform Admin access required"

#### Scenario: Create Resource — Duplicate Name Rejected
- GIVEN a resource already exists with name "Maintenance" (case-insensitive)
- WHEN a Super Admin calls `ResourceService.create()` with `{ name: "maintenance" }`
- THEN a `ConflictError` MUST be thrown with message indicating the name already exists

#### Scenario: Create Resource — Missing Name Rejected
- GIVEN a Super Admin calls `ResourceService.create()` with `{ description: "No name provided" }`
- WHEN the service executes
- THEN a `ValidationError` MUST be thrown with message "Resource name is required"

### Requirement: ResourceService — Get By ID
The system MUST provide a `ResourceService.getById()` method for retrieving a single resource.

#### Scenario: Get Resource By ID — Found
- GIVEN a verified Super Admin calls `ResourceService.getById()` with a valid resource ID
- WHEN the service executes
- THEN the method MUST return the `Resource` record with its `resourceRoles` relation populated (assigned roles)
- THEN each assigned role MUST include: id, name, description, organizationId

#### Scenario: Get Resource By ID — Not Found
- GIVEN a Super Admin calls `ResourceService.getById()` with a non-existent ID
- WHEN the service executes
- THEN a `NotFoundError` MUST be thrown with message "Resource not found"

#### Scenario: Get Resource By ID — Non-Platform Admin Denied
- GIVEN a user with TENANT_ADMIN role calls `ResourceService.getById()`
- WHEN the service executes
- THEN a `ForbiddenError` MUST be thrown with message "Platform Admin access required"

### Requirement: ResourceService — List
The system MUST provide a `ResourceService.list()` method for paginated resource listing.

#### Scenario: List Resources — Default Pagination
- GIVEN a verified Super Admin calls `ResourceService.list()` with no filters
- WHEN the service executes
- THEN the response MUST include a paginated result: `{ items: Resource[], pagination: { page, pageSize, total, totalPages } }`
- THEN the default page size MUST be 20
- THEN the default page MUST be 1

#### Scenario: List Resources — Search by Name
- GIVEN a Super Admin calls `ResourceService.list()` with `{ search: "maint" }`
- WHEN the service executes
- THEN the response MUST include only resources whose `name` matches "maint" (case-insensitive substring match)

#### Scenario: List Resources — Custom Pagination
- GIVEN a Super Admin calls `ResourceService.list()` with `{ page: 2, pageSize: 10 }`
- WHEN the service executes
- THEN the response MUST return page 2 with up to 10 items per page

#### Scenario: List Resources — Page Size Capped at 100
- GIVEN a Super Admin calls `ResourceService.list()` with `{ pageSize: 500 }`
- WHEN the service executes
- THEN the page size MUST be capped at 100

#### Scenario: List Resources — Non-Platform Admin Denied
- GIVEN a user with MEMBER role calls `ResourceService.list()`
- WHEN the service executes
- THEN a `ForbiddenError` MUST be thrown with message "Platform Admin access required"

### Requirement: ResourceService — Update
The system MUST provide a `ResourceService.update()` method for modifying an existing resource.

#### Scenario: Update Resource Name and Description
- GIVEN a verified Super Admin calls `ResourceService.update()` with `{ id: "res_1", data: { name: "Work Orders", description: "Updated description" } }`
- WHEN the service executes
- THEN the resource's `name` and `description` MUST be updated in the database
- THEN the response MUST include the updated resource object

#### Scenario: Update Resource — Partial Update (Name Only)
- GIVEN a verified Super Admin calls `ResourceService.update()` with `{ id: "res_1", data: { name: "New Name" } }`
- WHEN the service executes
- THEN only the `name` field MUST be updated; other fields (description) remain unchanged

#### Scenario: Update Resource — Replace Role Assignments
- GIVEN a resource exists with roles ["role_1", "role_2"] assigned
- WHEN a Super Admin calls `ResourceService.update()` with `{ id: "res_1", data: { roleIds: ["role_3"] } }`
- THEN all existing `ResourceRole` entries for the resource MUST be deleted
- THEN a new `ResourceRole` entry MUST be created linking the resource to "role_3"
- THEN the operation MUST use a database transaction (atomic)

#### Scenario: Update Resource — Non-Existent ID
- GIVEN a Super Admin calls `ResourceService.update()` with a non-existent resource ID
- WHEN the service executes
- THEN a `NotFoundError` MUST be thrown with message "Resource not found"

#### Scenario: Update Resource — Non-Platform Admin Denied
- GIVEN a user with TENANT_ADMIN role calls `ResourceService.update()`
- WHEN the service executes
- THEN a `ForbiddenError` MUST be thrown with message "Platform Admin access required"

### Requirement: ResourceService — Delete
The system MUST provide a `ResourceService.delete()` method for removing resources.

#### Scenario: Delete Resource — No Assigned Roles
- GIVEN a verified Super Admin calls `ResourceService.delete()` with a resource ID that has no assigned roles
- WHEN the service executes
- THEN the `Resource` record MUST be deleted from the database (cascading deletes remove any ResourceRole entries)
- THEN the response MUST be `{ success: true }`

#### Scenario: Delete Resource — Has Assigned Roles (Blocked)
- GIVEN a resource exists with one or more roles assigned via `ResourceRole`
- WHEN a Super Admin calls `ResourceService.delete()` with that resource ID
- THEN the method MUST query the `ResourceRole` count for the resource
- THEN a `ConflictError` MUST be thrown with message "Cannot delete resource with assigned roles"
- THEN the resource MUST NOT be deleted

#### Scenario: Delete Resource — Non-Existent ID
- GIVEN a Super Admin calls `ResourceService.delete()` with a non-existent resource ID
- WHEN the service executes
- THEN a `NotFoundError` MUST be thrown with message "Resource not found"

#### Scenario: Delete Resource — Non-Platform Admin Denied
- GIVEN a user with MEMBER role calls `ResourceService.delete()`
- WHEN the service executes
- THEN a `ForbiddenError` MUST be thrown with message "Platform Admin access required"

### Requirement: Resources API — List
The system MUST provide a `GET /api/dashboard/admin/resources` endpoint.

#### Scenario: List Resources — Success
- GIVEN a verified Super Admin sends `GET /api/dashboard/admin/resources?page=1&pageSize=20`
- WHEN the endpoint is called
- THEN `requireSuperAdmin()` MUST be invoked and pass
- THEN `ResourceService.list()` MUST be called with the parsed query parameters
- THEN the response MUST be a JSON object with `items` and `pagination` fields

#### Scenario: List Resources — Search Query
- GIVEN a Super Admin sends `GET /api/dashboard/admin/resources?search=maintenance`
- WHEN the endpoint is called
- THEN `ResourceService.list()` MUST be called with `{ search: "maintenance" }` in the filters

#### Scenario: List Resources — Unauthenticated
- GIVEN an unauthenticated user sends `GET /api/dashboard/admin/resources`
- WHEN the endpoint is called
- THEN the response MUST be 401 Unauthorized

#### Scenario: List Resources — Non-Super-Admin
- GIVEN a non-Super-Admin user sends `GET /api/dashboard/admin/resources`
- WHEN the endpoint is called
- THEN the response MUST be 403 Forbidden

### Requirement: Resources API — Create
The system MUST provide a `POST /api/dashboard/admin/resources` endpoint.

#### Scenario: Create Resource — Success
- GIVEN a verified Super Admin sends `POST /api/dashboard/admin/resources` with body `{ name: "Maintenance", description: "Manage maintenance requests" }`
- WHEN the endpoint is called
- THEN `ResourceService.create()` MUST be invoked with the parsed body
- THEN the response MUST be 201 Created with the created resource object

#### Scenario: Create Resource — With Role Assignments
- GIVEN a Super Admin sends `POST /api/dashboard/admin/resources` with body `{ name: "Maintenance", roleIds: ["role_1", "role_2"] }`
- WHEN the endpoint is called
- THEN `ResourceService.create()` MUST be invoked with the `roleIds` included

#### Scenario: Create Resource — Missing Name
- GIVEN a Super Admin sends `POST /api/dashboard/admin/resources` with body `{ description: "No name" }`
- WHEN the endpoint is called
- THEN the response MUST be 400 Bad Request with an error message

#### Scenario: Create Resource — Duplicate Name
- GIVEN a resource already exists with name "Maintenance"
- WHEN a Super Admin sends `POST /api/dashboard/admin/resources` with body `{ name: "Maintenance" }`
- THEN the response MUST be 409 Conflict with an error message

### Requirement: Resources API — Get By ID
The system MUST provide a `GET /api/dashboard/admin/resources/[id]` endpoint.

#### Scenario: Get Resource Detail — Success
- GIVEN a verified Super Admin sends `GET /api/dashboard/admin/resources/[id]` with a valid ID
- WHEN the endpoint is called
- THEN `ResourceService.getById()` MUST be invoked with the ID
- THEN the response MUST include the resource object with assigned roles

#### Scenario: Get Resource Detail — Not Found
- GIVEN a Super Admin sends `GET /api/dashboard/admin/resources/[nonExistentId]`
- WHEN the endpoint is called
- THEN the response MUST be 404 Not Found

### Requirement: Resources API — Update
The system MUST provide a `PATCH /api/dashboard/admin/resources/[id]` endpoint.

#### Scenario: Update Resource — Success
- GIVEN a verified Super Admin sends `PATCH /api/dashboard/admin/resources/[id]` with body `{ name: "Updated Name", description: "Updated" }`
- WHEN the endpoint is called
- THEN `ResourceService.update()` MUST be invoked with the ID and parsed body
- THEN the response MUST include the updated resource object

#### Scenario: Update Resource — Replace Role Assignments
- GIVEN a Super Admin sends `PATCH /api/dashboard/admin/resources/[id]` with body `{ roleIds: ["role_3", "role_4"] }`
- WHEN the endpoint is called
- THEN `ResourceService.update()` MUST be invoked with `roleIds` included
- THEN existing role assignments for the resource MUST be replaced (full replacement semantics)

#### Scenario: Update Resource — Not Found
- GIVEN a Super Admin sends `PATCH /api/dashboard/admin/resources/[nonExistentId]`
- WHEN the endpoint is called
- THEN the response MUST be 404 Not Found

### Requirement: Resources API — Delete
The system MUST provide a `DELETE /api/dashboard/admin/resources/[id]` endpoint.

#### Scenario: Delete Resource — Success
- GIVEN a verified Super Admin sends `DELETE /api/dashboard/admin/resources/[id]` for a resource with no assigned roles
- WHEN the endpoint is called
- THEN `ResourceService.delete()` MUST be invoked with the ID
- THEN the response MUST be 200 OK with `{ success: true }`

#### Scenario: Delete Resource — Has Assigned Roles (Blocked)
- GIVEN a resource exists with assigned roles
- WHEN a Super Admin sends `DELETE /api/dashboard/admin/resources/[id]` for that resource
- THEN the response MUST be 409 Conflict with an error message

#### Scenario: Delete Resource — Not Found
- GIVEN a Super Admin sends `DELETE /api/dashboard/admin/resources/[nonExistentId]`
- WHEN the endpoint is called
- THEN the response MUST be 404 Not Found
