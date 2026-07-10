# Delta for Super Admin Organization Management

## ADDED Requirements

### Requirement: Organization Lifecycle States
The system MUST support organization lifecycle states: PENDING, ACTIVE, SUSPENDED, ARCHIVED.

#### Scenario: Organization Creation
- GIVEN a Super Admin creates a new organization
- WHEN the organization is saved
- THEN the status MUST be set to PENDING
- THEN the `org-bootstrap.ts` hook MUST automatically create the 7 default roles
- THEN a unique `slug` MUST be automatically generated from the name

#### Scenario: Organization Activation
- GIVEN an organization is in PENDING state
- WHEN the first admin user is added and accepts their invite
- THEN the status MUST transition to ACTIVE

#### Scenario: Organization Suspension
- GIVEN an organization is in ACTIVE state
- WHEN a Super Admin suspends the organization
- THEN the status MUST transition to SUSPENDED
- THEN all active sessions for members of that organization MUST be invalidated

#### Scenario: Organization Archival (Terminal)
- GIVEN an organization is in ACTIVE or SUSPENDED state
- WHEN a Super Admin archives the organization
- THEN the status MUST transition to ARCHIVED
- THEN this state MUST be terminal (no restoration possible)

#### Scenario: Invalid State Transition
- GIVEN an organization is in ARCHIVED state
- WHEN any user attempts to change the status
- THEN the system MUST reject the request with a 400 Bad Request error

### Requirement: Global Database Access
The system MUST provide an explicitly unscoped database client for Super Admin operations.

#### Scenario: Super Admin Queries All Organizations
- GIVEN a verified Super Admin accesses the organization list
- WHEN the API route executes
- THEN it MUST use the unscoped `globalDb` client from `lib/global-db.ts`
- THEN it MUST return organizations from ALL tenants with enforced pagination (default 20 per page)

#### Scenario: Non-Super-Admin Cannot Access Global Client
- GIVEN a non-Super-Admin user attempts to access an admin API route
- WHEN the route is guarded by `requireSuperAdmin()`
- THEN the request MUST be rejected with a 403 Forbidden error

### Requirement: Custom Role Management with Safety Checks
The system MUST support custom role CRUD with default role protection and deletion safety.

#### Scenario: Org Admin Creates Custom Role
- GIVEN an Organization Admin is managing their organization
- WHEN they create a new custom role
- THEN the role MUST be scoped to their organization

#### Scenario: Org Admin Cannot Edit Default Roles
- GIVEN an Organization Admin views their organization's roles
- WHEN they attempt to edit or delete a role where `isDefault = true`
- THEN the system MUST block the action with a 403 Forbidden error

#### Scenario: Role Deletion Safety Check
- GIVEN an admin attempts to delete a role
- WHEN the role is currently assigned to one or more members
- THEN the system MUST return a warning with the count of affected members
- THEN the deletion MUST only proceed after explicit confirmation

### Requirement: Global Permission Catalog Management
Super Admins MUST be able to manage the global permission catalog.

#### Scenario: Add New Permission
- GIVEN a Super Admin accesses the global permissions page
- WHEN they create a new permission
- THEN the permission MUST follow the `resource:action` syntax

#### Scenario: Org Admin Cannot Modify Catalog
- GIVEN an Organization Admin attempts to add or remove permissions from the global catalog
- WHEN the request reaches the API
- THEN the system MUST reject the request with a 403 Forbidden error

### Requirement: Audit Logging
The system MUST record security-relevant admin actions in an audit log.

#### Scenario: Admin Action Logged
- GIVEN a Super Admin or Org Admin performs a mutation
- WHEN the action completes
- THEN an audit log entry MUST be created with: timestamp, userId, userName, action, resourceType, resourceId, organizationId, ipAddress, userAgent, success, metadata

#### Scenario: Audit Log Access Scoping
- GIVEN a Super Admin views the audit log
- WHEN they access `/admin/audit-logs`
- THEN they MUST see audit entries from ALL organizations

#### Scenario: Org Admin Audit Log Scoping
- GIVEN an Org Admin views the audit log
- WHEN they access their organization's audit tab
- THEN they MUST only see audit entries for THEIR organization

### Requirement: Extreme Event Notifications
The system MUST send branded email notifications when extreme events occur.

#### Scenario: Mass Deletion Notification
- GIVEN a user deletes more than 100 records of any type within a 1-hour window
- WHEN the threshold is exceeded
- THEN an email notification MUST be sent to all Super Admins and the Org Admin of the affected organization

#### Scenario: Notification Rate Limiting
- GIVEN an extreme event triggers notifications
- WHEN 5 notifications for the same event type have been sent within 24 hours
- THEN subsequent notifications for that event type MUST be suppressed until the 24-hour window expires

#### Scenario: Email Branding
- GIVEN a notification email is sent
- WHEN the email is rendered
- THEN it MUST use the Property NI Navy (#1B2A4A) header and Amber (#F5A623) accents

### Requirement: Strict Platform Organization Gating
All Super Admin UI components, pages, and API routes MUST be strictly accessible ONLY to users who are active members of the Platform (Super Admin) Organization.

#### Scenario: Non-Platform User Cannot See Admin Navigation
- GIVEN a standard tenant user is logged in
- WHEN the main application layout renders
- THEN navigation links to `/admin/*` routes MUST NOT be visible

#### Scenario: Non-Platform User Cannot Access Admin Pages Directly
- GIVEN a standard tenant user manually navigates to `/admin/organizations`
- WHEN the page loads
- THEN the `<RequireSuperAdmin>` component MUST render the `<AccessDenied>` fallback UI

### Requirement: Conditional Root Routing
The root route (`/`) must dynamically route users based on their role.

#### Scenario: Super Admin Visits Root URL
- GIVEN a Super Admin user logs in successfully
- WHEN they are redirected to the root URL (`/`)
- THEN the system MUST automatically redirect them to `/admin/organizations`

#### Scenario: Tenant User Visits Root URL
- GIVEN a standard tenant user logs in successfully
- WHEN they are redirected to the root URL (`/`)
- THEN the system MUST render the standard tenant homepage/dashboard

### Requirement: UI Design System Compliance & Accessibility
All new UI components MUST use the Property NI design system and be accessible.

#### Scenario: Color Tokens
- GIVEN any new UI component is created
- WHEN styling is applied
- THEN it MUST use Property NI Navy (`#1B2A4A`) for primary elements and Amber (`#F5A623`) for accents

#### Scenario: Status Badges
- GIVEN an organization status is displayed in the UI
- WHEN the status is ACTIVE, the badge MUST be green
- WHEN the status is PENDING, the badge MUST be amber/yellow
- WHEN the status is SUSPENDED, the badge MUST be red

#### Scenario: Icon Button Accessibility
- GIVEN an icon-only button is rendered (e.g., Edit, Delete, View)
- WHEN the button is rendered
- THEN it MUST include an `aria-label` attribute describing its action

### Requirement: Build & Runtime Safety
The system MUST compile without errors and MUST NOT throw Edge Runtime violations.

#### Scenario: Build Succeeds
- GIVEN all new code is written
- WHEN `npm run build` is executed
- THEN the build MUST complete with zero errors
- THEN there MUST be no "Module not found" errors related to casing mismatches

#### Scenario: No Edge Runtime Violations
- GIVEN the middleware is loaded
- WHEN the application starts
- THEN there MUST be no "PrismaClientValidationError: In order to run Prisma Client on edge runtime" errors
- THEN there MUST be no "ioredis is not defined" errors

### Requirement: Non-Regression of Previous Proposals
This proposal MUST NOT break any functionality from `project-initialization`, `authentication-ui`, or `authorization-rbac`.

#### Scenario: Logout Flow Preserved
- GIVEN a user is logged in
- WHEN they click "Logout"
- THEN all session cookies MUST be cleared and the session invalidated in the database

#### Scenario: Tenant Isolation Preserved
- GIVEN a tenant user makes a request
- WHEN the Prisma Extension processes the query
- THEN the query MUST be scoped to the user's organizationId
- THEN no cross-organization data leakage MUST occur