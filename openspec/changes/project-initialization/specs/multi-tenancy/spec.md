# Delta for Multi-Tenancy & Tenant Isolation

## ADDED Requirements

### Requirement: Tenant Isolation Invariant
The application MUST enforce a strict tenant isolation invariant: **no tenant may ever access another tenant's data, under any circumstances**. This is a non-negotiable security property that takes precedence over all other functional requirements.

#### Scenario: Fundamental Security Property
- GIVEN any user is authenticated and belongs to Organization A
- WHEN they attempt to access any data
- THEN they MUST only see data belonging to Organization A
- THEN any attempt to access Organization B's data MUST be blocked, regardless of the method used (UI, API, raw SQL, direct DB access)
- THEN this invariant MUST hold even in the presence of application bugs, unless the bug is in the isolation layer itself

#### Scenario: Defense-in-Depth Strategy
- GIVEN the tenant isolation requirement
- WHEN the architecture is designed
- THEN isolation MUST be enforced at multiple independent layers:
  - **Layer 1: Application Layer** — Prisma Extension that automatically scopes all queries to the current organization
  - **Layer 2: Database Layer** — PostgreSQL Row Level Security (RLS) policies that filter rows by organization
- THEN a failure in one layer MUST NOT result in data leakage, because the other layer still enforces isolation

#### Scenario: organizationId as Foundation
- GIVEN the defense-in-depth strategy is implemented
- WHEN any organization-scoped model is created
- THEN the model MUST include a non-optional `organizationId` field
- THEN both Layer 1 (Prisma Extension) and Layer 2 (RLS) DEPEND on this field being present
- THEN if `organizationId` is missing from any organization-scoped model, BOTH layers of tenant isolation are broken for that model
- THEN this MUST be treated as a critical security vulnerability requiring immediate remediation

### Requirement: Prisma Tenant Extension (Application Layer)
The application MUST provide a tenant-scoped Prisma client that automatically injects the current organization ID into all queries on organization-scoped models.

#### Scenario: Tenant-Scoped Client
- GIVEN the application is handling a request
- WHEN database queries are executed
- THEN they MUST use the tenant-scoped Prisma client (`lib/tenant-db.ts`)
- THEN the client MUST automatically inject `organizationId: <currentOrgId>` into the `where` clause of all queries on organization-scoped models
- THEN this MUST apply to `findMany`, `findFirst`, `findUnique`, `update`, `updateMany`, `delete`, `deleteMany`, `count`, `aggregate`, and `groupBy` operations

#### Scenario: Tenant Context via AsyncLocalStorage
- GIVEN a request arrives with an authenticated user
- WHEN the request is processed
- THEN the user's active organization ID MUST be stored in Node.js `AsyncLocalStorage` (`lib/tenant-context.ts`)
- THEN the tenant-scoped Prisma client MUST read the current organization ID from this context
- THEN the context MUST be set by Next.js middleware before any business logic runs

#### Scenario: Rejection of Unscoped Queries
- GIVEN the tenant-scoped Prisma client is used
- WHEN a query is attempted without a resolvable organization context
- THEN the query MUST be rejected with a clear error (e.g., "No active organization context")
- THEN no data MUST be returned

#### Scenario: Models Exempt from Scoping
- GIVEN certain models are global (not organization-scoped)
- WHEN queries are executed on these models
- THEN the Prisma extension MUST NOT inject organization filtering
- THEN the following models are exempt: `User`, `Session`, `Account`, `Organization`, `Member`, `Invitation`
- THEN all other models MUST be organization-scoped by default

#### Scenario: Developer Discipline via Linting
- GIVEN the tenant-scoped Prisma client exists
- WHEN developers write business logic
- THEN an ESLint rule MUST prevent direct imports of the unscoped `prisma` client from `lib/db.ts` in business logic files
- THEN developers MUST import from `lib/tenant-db.ts` instead
- THEN the lint rule MUST be enforced in pre-commit hooks and CI

### Requirement: PostgreSQL Row Level Security (Database Layer)
The database MUST enforce tenant isolation via PostgreSQL Row Level Security (RLS) policies as a safety net against application-layer failures.

#### Scenario: RLS Enablement
- GIVEN the database is initialized
- WHEN migrations are applied
- THEN RLS MUST be enabled on every table that contains an `organizationId` column
- THEN RLS policies MUST be created for each such table, filtering by the current session's organization ID

#### Scenario: Session Variable for RLS
- GIVEN a request is being processed with an authenticated user
- WHEN database queries are executed
- THEN the current organization ID MUST be set as a PostgreSQL session variable (`app.current_org_id`) before any queries
- THEN the session variable MUST be scoped to the current transaction (using `set_config(..., true)`)
- THEN RLS policies MUST reference this session variable in their `USING` clauses

#### Scenario: RLS Policy Template
- GIVEN a new organization-scoped table is created
- WHEN the migration is written
- THEN the migration MUST include:
  - `ALTER TABLE "<table>" ENABLE ROW LEVEL SECURITY;`
  - `CREATE POLICY tenant_isolation ON "<table>" USING ("organizationId"::text = current_setting('app.current_org_id', true));`
- THEN the policy MUST apply to all roles (including the database user used by the application)

#### Scenario: RLS Bypass Prevention
- GIVEN RLS is enabled on a table
- WHEN any query is executed against that table
- THEN the RLS policy MUST apply regardless of how the query is constructed
- THEN raw SQL queries (`prisma.$executeRaw`, `prisma.$queryRaw`) MUST also be subject to RLS
- THEN direct database access (e.g., via psql) MUST be subject to RLS unless using a superuser role

#### Scenario: RLS Migration Scaffolding
- GIVEN the project is initialized
- WHEN the Prisma migrations directory is created
- THEN a template migration file MUST be created (`prisma/migrations/0000_enable_rls/migration.sql`) demonstrating the RLS pattern
- THEN the template MUST include comments explaining how to apply RLS to new tables
- THEN actual RLS policies for business tables will be added in future feature proposals when those tables are created

### Requirement: Tenant Context Middleware
Next.js middleware MUST establish the tenant context for every authenticated request before any business logic runs.

#### Scenario: Context Establishment
- GIVEN an authenticated request arrives
- WHEN Next.js middleware processes the request
- THEN the middleware MUST extract the user's active organization ID from the session
- THEN the middleware MUST store the organization ID in `AsyncLocalStorage` via `lib/tenant-context.ts`
- THEN all downstream code (Route Handlers, Server Components) MUST have access to the tenant context

#### Scenario: Missing Context Handling
- GIVEN an authenticated user has no active organization
- WHEN they attempt to access organization-scoped resources
- THEN they MUST be redirected to the organization selection/creation flow
- THEN no database queries MUST be executed without a valid tenant context

#### Scenario: Organization Switching
- GIVEN a user belongs to multiple organizations
- WHEN they switch their active organization
- THEN the tenant context MUST be updated to reflect the new organization
- THEN subsequent queries MUST be scoped to the new organization

### Requirement: Tenant Isolation Testing
The test suite MUST include explicit tests that verify tenant isolation at every layer.

#### Scenario: Application-Layer Isolation Tests
- GIVEN the test suite is executed
- WHEN tenant isolation tests run
- THEN tests MUST verify that a user in Organization A cannot read, update, or delete data belonging to Organization B
- THEN tests MUST cover all CRUD operations on organization-scoped models
- THEN these tests MUST be organized in `tests/isolation/application/`

#### Scenario: Database-Layer Isolation Tests
- GIVEN the test suite is executed
- WHEN RLS isolation tests run
- THEN tests MUST execute raw SQL queries attempting cross-tenant access
- THEN tests MUST verify that RLS blocks these queries even when application-layer scoping is bypassed
- THEN these tests MUST be organized in `tests/isolation/database/`

#### Scenario: Regression Test Requirement
- GIVEN a new feature is added that touches organization-scoped data
- WHEN the feature is implemented
- THEN tenant isolation tests MUST be updated to cover the new feature
- THEN a failure in tenant isolation tests MUST block the PR from merging

#### Scenario: Test Scaffolding
- GIVEN the project is initialized
- WHEN the test directory structure is created
- THEN `tests/isolation/` directory MUST be created with:
  - `tests/isolation/application/` (Application-layer isolation test scaffolding)
  - `tests/isolation/database/` (Database-layer isolation test scaffolding)
  - `tests/isolation/README.md` (Documentation of isolation testing strategy)
- THEN template test files MUST demonstrate the pattern for writing isolation tests
- THEN actual isolation tests will be added when business data models are created in future proposals

### Requirement: Tenant Isolation Documentation
The project MUST maintain clear documentation of the tenant isolation strategy for current and future developers.

#### Scenario: Architecture Documentation
- GIVEN the project is initialized
- WHEN the README is reviewed
- THEN it MUST contain a dedicated section explaining the tenant isolation strategy
- THEN the documentation MUST explain:
  - The tenant isolation invariant
  - The defense-in-depth approach (Prisma Extension + RLS)
  - How to use the tenant-scoped Prisma client
  - How to add RLS policies for new tables
  - The ESLint rule preventing direct `prisma` imports

#### Scenario: Developer Onboarding
- GIVEN a new developer joins the project
- WHEN they read the documentation
- THEN they MUST understand:
  - Why tenant isolation is non-negotiable
  - How to write queries that respect tenant boundaries
  - What happens if they try to bypass the isolation layers
  - How to test tenant isolation for new features

### Requirement: Audit Logging for Cross-Tenant Access Attempts
The application MUST log all attempts to access data outside the current tenant's scope.

#### Scenario: Blocked Access Logging
- GIVEN a user attempts to access data from another organization
- WHEN the attempt is blocked by the application layer or RLS
- THEN the attempt MUST be logged with:
  - User ID
  - Attempted organization ID
  - Actual organization ID
  - Resource type and ID
  - Timestamp
  - IP address
- THEN these logs MUST be structured (JSON) and tagged for security monitoring

#### Scenario: Audit Log Scaffolding
- GIVEN the project is initialized
- WHEN the audit logging infrastructure is scaffolded
- THEN `lib/audit.ts` MUST be created with boilerplate for audit log events
- THEN the audit logger MUST integrate with the structured logger (`lib/logger.ts`)
- THEN actual audit log persistence (database table, external service) will be defined in future proposals