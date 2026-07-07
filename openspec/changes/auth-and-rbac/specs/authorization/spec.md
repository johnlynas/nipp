# Delta for Authorization

## ADDED Requirements

### Requirement: Permission Catalog
The system MUST maintain a master catalog of permissions in the database.

#### Scenario: Permission Syntax
- GIVEN the permission catalog is defined
- WHEN permissions are created or referenced
- THEN they MUST follow the `resource:action` syntax (e.g., `properties:view`, `tenants:create`).

#### Scenario: Bootstrapping
- GIVEN the database is initialized or updated
- WHEN the `prisma/seed.ts` script is executed
- THEN it MUST insert any missing permissions into the database.

### Requirement: Platform Organization & Super Admin
The system MUST utilize a dedicated Platform Organization for Super Admins.

#### Scenario: Super Admin Access
- GIVEN a user is a member of the Platform Organization
- WHEN they access the system
- THEN they MUST have global authority over all infrastructure and tenant organizations.

#### Scenario: Platform Organization Security
- GIVEN the Platform Organization ID is configured
- WHEN an API request attempts to invite a user to, or modify roles within, the Platform Organization
- THEN the system MUST verify the requester is already a verified Super Admin.
- THEN if the requester is not a Super Admin, the request MUST be blocked with a 403 Forbidden error.

### Requirement: Default & Custom Roles
The system MUST support 7 default organization-scoped roles and allow custom roles.

#### Scenario: Default Roles
- GIVEN a new tenant organization is created
- WHEN roles are assigned
- THEN the system MUST support the 7 default roles: Organization Admin, Property Manager, Letting Agent, Accountant, Maintenance Staff, Tenant, Contractor.

#### Scenario: Custom Roles
- GIVEN an Organization Admin is managing their organization
- WHEN they create a new role
- THEN the role MUST be strictly scoped to their organization.
- THEN they MUST be able to map a specific subset of permissions from the master catalog to this custom role.

### Requirement: Caching Strategy
The system MUST cache resolved user permissions to ensure high performance.

#### Scenario: Redis Caching
- GIVEN a user makes an authenticated request requiring permission checks
- WHEN the backend resolves their permissions
- THEN it MUST first check Redis for the user's permission set.
- THEN if not in Redis, it MUST fetch from the database, store in Redis, and set a Time-To-Live (TTL) of 5 minutes.

### Requirement: Frontend Integration
The frontend MUST have access to the user's permissions to conditionally render the UI.

#### Scenario: Session Augmentation
- GIVEN a user logs in or refreshes their session
- WHEN the BetterAuth session is generated
- THEN the session object MUST include the user's resolved permissions array.

#### Scenario: UI Rendering
- GIVEN a user is viewing a page
- WHEN the UI evaluates whether to show a specific button or tab
- THEN it MUST use a `usePermission` hook or `<RequirePermission>` component to check the session object.
- THEN the element MUST only be rendered if the session includes the required permission.

### Requirement: Non-Regression of Logout Flow
The authorization system MUST NOT interfere with the logout flow established in `authentication-ui`.

#### Scenario: Logout After Authorization Implementation
- GIVEN a user is logged in with permissions cached in their session
- WHEN they click "Logout"
- THEN the system MUST clear all session cookies (both dot and dash variants)
- THEN the system MUST invalidate the session in the database
- THEN the system MUST perform a full page reload
- THEN cross-tab session invalidation MUST still work
- THEN the user MUST be redirected to `/login`

#### Scenario: Safe Session Augmentation
- GIVEN a user has a valid session
- WHEN the BetterAuth session callback attempts to resolve permissions
- THEN if the permission resolution fails (e.g., Redis is down, DB error)
- THEN the session MUST remain valid
- THEN the permissions array MUST default to empty
- THEN the user MUST NOT be logged out due to a permission resolution error

### Requirement: Automatic Role Bootstrapping
The system MUST automatically create default roles when a new tenant organization is created.

#### Scenario: New Organization Creation
- GIVEN a user creates a new organization via the BetterAuth organization plugin
- WHEN the organization is successfully created
- THEN the system MUST automatically create the 7 default roles for that organization
- THEN the system MUST map default permissions to each role
- THEN the organization creator MUST be assigned the "Organization Admin" role
- THEN no manual `npm run db:seed` execution MUST be required