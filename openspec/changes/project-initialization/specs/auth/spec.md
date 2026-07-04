# Delta for Auth

## ADDED Requirements

### Requirement: Authentication Framework Configuration
BetterAuth SHALL be configured as the primary Authentication and Authorization framework.

#### Scenario: BetterAuth Boilerplate
- GIVEN the application requires user authentication
- WHEN the initialization phase completes
- THEN the `lib/auth.ts` file MUST contain the minimal boilerplate to initialize BetterAuth with the Prisma adapter, Email/Password plugin, Google OIDC plugin, Admin plugin, and Organization plugin.

### Requirement: Local Credential Data Model
The system MUST support local user registration and login using an email/username and password.

#### Scenario: Database Schema for Local Users
- GIVEN the Prisma schema is being configured
- WHEN the User model is defined
- THEN it MUST include a `passwordHash` field to store the securely hashed password.

### Requirement: OIDC Authentication Data Model
The system MUST support OpenID Connect (OIDC) for social logins, initially restricted to Google.

#### Scenario: Database Schema for OIDC
- GIVEN the Prisma schema is being configured
- WHEN the Account model is defined
- THEN it MUST include fields to map external OIDC provider identities (like Google) to internal application users.

### Requirement: Authorization Model Configuration
The system MUST be configured to support an Authorization model utilizing BetterAuth's capabilities.

#### Scenario: Access Control Setup
- GIVEN BetterAuth is initialized
- WHEN the configuration is written
- THEN it MUST include the boilerplate to enforce Role-Based Access Control (RBAC) or Attribute-Based Access Control (ABAC) rules.

### Requirement: Same-Origin Cookie Configuration
BetterAuth cookies MUST be configured for same-origin use (no cross-origin complexity).

#### Scenario: Cookie Attributes
- GIVEN the application is running
- WHEN BetterAuth sets session cookies
- THEN cookies MUST use standard same-site attributes (`SameSite=Lax` for most cases).
- THEN no `trustedOrigins` configuration MUST be required.
- THEN no cross-origin cookie domain configuration MUST be required.

### Requirement: BetterAuth Route Handler Integration
BetterAuth MUST be integrated via Next.js Route Handlers using `toNextJsHandler`.

#### Scenario: Auth Route Handler File
- GIVEN the application requires authentication endpoints
- WHEN the `app/api/auth/[...all]/route.ts` file is created
- THEN it MUST import the BetterAuth instance from `lib/auth.ts`.
- THEN it MUST export GET and POST handlers via `toNextJsHandler(auth)`.
- THEN all BetterAuth endpoints MUST be accessible under `/api/auth/*`.

### Requirement: Google OIDC Callback URL Registration
The Google OIDC callback URL MUST be registered in the Google Cloud Console to match the Next.js API route.

#### Scenario: Callback URL Configuration
- GIVEN the Google OIDC provider is configured in BetterAuth
- WHEN a user initiates Google login
- THEN Google MUST redirect the user to the callback URL registered in the Google Cloud Console.
- THEN the callback URL MUST be `/api/auth/callback/google` (relative to the application origin).

#### Scenario: Callback URL Documentation
- GIVEN the project initialization is complete
- WHEN the README or setup documentation is reviewed
- THEN clear instructions MUST be provided for registering the callback URL in the Google Cloud Console.

### Requirement: BetterAuth Admin Plugin Configuration
The application MUST configure the BetterAuth Admin Plugin to enable administrative user and session management.

#### Scenario: Admin Plugin Initialization
- GIVEN the application requires administrative capabilities
- WHEN BetterAuth is initialized in `lib/auth.ts`
- THEN the admin plugin MUST be enabled with configuration for default and admin roles.
- THEN the admin role MUST be configurable (e.g., "super_admin").
- THEN the plugin MUST provide APIs for user listing, user creation, user banning, session management, and user impersonation.

#### Scenario: Admin Role Assignment
- GIVEN a user is created via the registration flow
- WHEN the user is the first user in the system
- THEN the user MAY be automatically assigned the admin role (configurable).
- THEN subsequent users MUST be assigned the default role (e.g., "tenant").

### Requirement: BetterAuth Organization Plugin Configuration (Multi-Tenancy)
The application MUST configure the BetterAuth Organization Plugin to enable multi-tenancy with organization-scoped roles and permissions.

#### Scenario: Organization Plugin Initialization
- GIVEN the application requires multi-tenancy capabilities
- WHEN BetterAuth is initialized in `lib/auth.ts`
- THEN the organization plugin MUST be enabled with configuration for:
  - Organization schema extensions (company name, settings, metadata)
  - Organization-scoped role definitions for property management industry
  - Permission sets for each role
  - Allow users to belong to multiple organizations
- THEN the plugin MUST provide APIs for organization CRUD, member management, invitations, and organization switching.

#### Scenario: Organization Data Models
- GIVEN the organization plugin is configured
- WHEN the Prisma schema is generated
- THEN it MUST include `Organization`, `Member`, and `Invitation` models.
- THEN the `Member` model MUST link users to organizations with organization-scoped roles.

#### Scenario: Organization-Scoped Roles
- GIVEN the organization plugin is configured
- WHEN roles are defined
- THEN they MUST be scoped to organizations (a user can have different roles in different organizations).
- THEN the following role templates MUST be scaffolded:
  - Property Owner
  - Property Manager
  - Letting Agent
  - Maintenance Staff
  - Tenant
  - Accountant
  - Contractor (placeholder for future implementation)

#### Scenario: Organization Configuration File
- GIVEN the organization plugin is configured
- WHEN `lib/organization.ts` is created
- THEN it MUST contain boilerplate for organization plugin configuration and helper functions.
- THEN it MUST export utilities for:
  - Getting the current organization from session
  - Scoping Prisma queries to the current organization
  - Checking organization-scoped permissions

### Requirement: Custom Roles Configuration Scaffolding
The application MUST provide scaffolding for custom role definitions that reflect property management industry organizational structures.

#### Scenario: Role Template Files
- GIVEN the project initialization is complete
- WHEN the `lib/roles/` directory is created
- THEN it MUST contain template files for property management roles (e.g., `property-management.ts`).
- THEN it MUST contain template files for letting agent roles (e.g., `letting.ts`).
- THEN it MUST contain template files for maintenance roles (e.g., `maintenance.ts`).
- THEN it MUST contain a template file for contractor roles (e.g., `contractor.ts`) as a placeholder for future implementation.
- THEN each template file MUST define role structures with placeholder permission arrays.

#### Scenario: Permission Definition Files
- GIVEN the project initialization is complete
- WHEN the `lib/permissions/` directory is created
- THEN it MUST contain permission definition files organized by domain (e.g., `property.ts`, `tenant.ts`, `financial.ts`, `maintenance.ts`, `contractor.ts`).
- THEN each permission file MUST export a typed list of permissions (e.g., `properties:view`, `properties:create`, `tenants:manage`).

#### Scenario: Organizational Structure Flexibility
- GIVEN the role configuration scaffolding is in place
- WHEN a future implementation phase begins
- THEN the scaffolding MUST support:
  - Defining custom role hierarchies (e.g., Director → Regional Manager → Property Manager)
  - Permission inheritance through role hierarchies
  - Tenant-scoped roles (different roles per organization)
  - Custom permission sets per organization

### Requirement: Organization Management Directory Structure Scaffolding
The frontend MUST provide a scaffolded directory structure for organization management.

#### Scenario: Organization Directory Structure
- GIVEN the project initialization is complete
- WHEN the `app/organizations/` directory is created
- THEN it MUST contain subdirectories for:
  - `create/` (Create organization page)
  - `[orgId]/` (Organization detail page)
  - `[orgId]/members/` (Member management)
  - `[orgId]/settings/` (Organization settings)
  - `[orgId]/invitations/` (Invitation management)
- THEN each subdirectory MUST be empty or contain only placeholder files indicating future implementation.

#### Scenario: Organization Switching Component
- GIVEN the organization plugin is configured
- WHEN the organization switching component is scaffolded
- THEN `components/organization-switcher.tsx` MUST be created with placeholder UI for switching between organizations.
- THEN it MUST integrate with the BetterAuth organization plugin APIs.

#### Scenario: Organization Context Provider
- GIVEN the organization plugin is configured
- WHEN the organization context provider is scaffolded
- THEN `lib/organization-context.tsx` MUST be created with placeholder logic for:
  - Storing the current organization in React context
  - Providing organization data to child components
  - Handling organization switching

### Requirement: Admin Dashboard Directory Structure Scaffolding
The frontend MUST provide a scaffolded directory structure for the admin dashboard interface.

#### Scenario: Admin Directory Structure
- GIVEN the project initialization is complete
- WHEN the `app/admin/` directory is created
- THEN it MUST contain subdirectories for:
  - `users/` (User management pages)
  - `roles/` (Role management pages)
  - `permissions/` (Permission management pages)
  - `organizations/` (Organization management pages)
  - `audit/` (Audit log pages)
  - `settings/` (System settings pages)
- THEN each subdirectory MUST be empty or contain only placeholder files indicating future implementation.

#### Scenario: Admin Layout Scaffolding
- GIVEN the admin dashboard directory structure is scaffolded
- WHEN the `app/admin/layout.tsx` file is created
- THEN it MUST provide a placeholder layout structure for the admin interface.
- THEN the layout MUST be designed to integrate with the Property NI design system in future implementation.

### Requirement: Role-Specific User Dashboard Scaffolding
The frontend MUST provide scaffolded directory structures for role-specific user dashboards.

#### Scenario: Dashboard Directory Structure
- GIVEN the project initialization is complete
- WHEN the `app/dashboard/` directory is created
- THEN it MUST contain subdirectories for each major property management role:
  - `owner/` (Property owner dashboard)
  - `manager/` (Property manager dashboard)
  - `agent/` (Letting agent dashboard)
  - `maintenance/` (Maintenance staff dashboard)
  - `tenant/` (Tenant dashboard)
  - `accountant/` (Accountant dashboard)
  - `contractor/` (Contractor dashboard — scaffolding only; full implementation deferred to future OpenSpec proposal)
- THEN each subdirectory MUST be empty or contain only placeholder files indicating future implementation.

#### Scenario: Contractor Dashboard Placeholder
- GIVEN the contractor dashboard directory is scaffolded
- WHEN the `app/dashboard/contractor/` directory is created
- THEN it MUST contain a placeholder file (e.g., `README.md`) indicating that the full Contractor dashboard implementation is deferred to a future OpenSpec proposal.
- THEN the placeholder MUST document the planned Contractor functionality (quoting, job scheduling, work order management, site access, invoicing, communication).

#### Scenario: Dashboard Routing Boilerplate
- GIVEN the role-specific dashboard directories are scaffolded
- WHEN the `lib/dashboard-router.ts` file is created
- THEN it MUST contain placeholder logic for routing users to their role-specific dashboard.
- THEN it MUST define a mapping structure between user roles and dashboard directories.
- THEN the mapping MUST include the contractor role with a placeholder indicating future implementation.

#### Scenario: Role-Based Dashboard Access
- GIVEN a user is authenticated
- WHEN they access the `/dashboard` route
- THEN the application MUST determine their role and route them to the appropriate dashboard subdirectory.
- THEN users without a recognized role MUST be shown a default dashboard or error message.

### Requirement: Authentication Scope Boundaries
The initialization phase MUST implement only the essential authentication features. Additional authentication plugins and features are explicitly deferred.

#### Scenario: In-Scope Authentication Features
- GIVEN the initialization phase is executing
- WHEN authentication features are being configured
- THEN the following MUST be implemented:
  - Email/password local authentication
  - Google OIDC social login (single provider only)
  - Organization-based multi-tenancy via Organization plugin
  - Admin plugin for user management
  - test-utils for authentication testing
- THEN no other authentication plugins or features MUST be implemented.

#### Scenario: Out-of-Scope Authentication Features
- GIVEN the initialization phase is executing
- WHEN considering additional authentication features
- THEN the following MUST NOT be implemented:
  - Two-Factor Authentication (2FA)
  - API Key plugin
  - Magic Link plugin
  - Email OTP plugin
  - Bearer token plugin
  - Multi-Session plugin
  - SSO plugin
  - JWT plugin
  - Stripe plugin
  - SAML SSO with Okta
  - Additional social providers (beyond Google)
  - Email verification
  - Password reset flow
- THEN these features MUST be documented in the "Deferred Items Registry" section of the proposal.

#### Scenario: Single Social Provider Constraint
- GIVEN the OIDC configuration is being set up
- WHEN social providers are configured
- THEN ONLY Google MUST be configured as a social provider.
- THEN no other social providers (GitHub, Microsoft, Apple, etc.) MUST be configured in this phase.
- THEN the architecture MUST support adding additional providers in future phases without refactoring.