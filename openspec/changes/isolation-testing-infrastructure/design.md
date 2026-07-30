# Design: Isolation Testing Infrastructure

## Technical Approach
- **Test Database**: Dedicated `nipp_test` PostgreSQL database, created fresh per test run via shell script + Prisma
- **Test Infrastructure**: Docker Compose for PostgreSQL + pgbouncer; `next dev` or `next start` for the application server
- **E2E Tests**: Playwright with TypeScript, running against live server
- **Unit Tests**: Vitest for application-layer tests (tenant-db.ts, tenant-context.ts, global-db-guard.ts)
- **Test Data**: Seeded via `prisma/seed.ts` with OrgA, OrgB, and tenant users

## Architecture Decisions

### Decision: Fresh Database Per Test Run
Create a new `nipp_test` database from scratch for each test run, rather than truncating an existing one.
*Why:* Eliminates state leakage between runs. The seed script is idempotent and fast enough for this approach.

### Decision: Docker Compose for Test Infrastructure
Use `docker-compose.test.yml` to orchestrate PostgreSQL and pgbouncer containers. The Next.js server runs locally via `next dev`.
*Why:* Consistent environment across developer machines and CI. pgbouncer must be running as it is in the dev env.

### Decision: Playwright for E2E, Vitest for Unit
Split testing into two layers:
- **Playwright**: Browser-level tests that hit the live Next.js server (auth flows, UI rendering, API responses)
- **Vitest**: Direct library tests that import and test `tenant-db.ts`, `tenant-context.ts`, `global-db-guard.ts` against the test database
*Why:* Playwright is ideal for testing full request/response cycles with real cookies and sessions. Vitest is faster and more appropriate for unit-level library tests.

### Decision: Shared Seed Script for Dev and Test
The `prisma/seed.ts` script detects the target database (via connection string or env var) and seeds accordingly. For `nipp_test`, it creates OrgA, OrgB, and tenant users. For `nipp_dev`, it creates the Platform Organization and super admin user (existing behavior).
*Why:* Single source of truth for seeding logic. The seed script already handles the Platform Org; we extend it to also handle test orgs when running against `nipp_test`.

### Decision: Environment Variables for Test Credentials
Use dedicated env vars (`TEST_ADMIN_EMAIL`, `TEST_TENANT_A_EMAIL`, etc.) rather than reusing dev credentials.
*Why:* Prevents accidental use of real user accounts in tests. Allows independent credential rotation for test vs dev environments.

### Decision: Test Isolation via Database Truncation
Within a single test run, truncate all org-scoped tables between Playwright test files to ensure clean state.
*Why:* Prevents tests from interfering with each other within the same run.

### Decision: `.env.test` Excluded from Git
The actual test credentials file (`.env.test`) is added to `.gitignore`. Only `.env.test.example` with placeholder values is committed.
*Why:* Prevents test credentials from being accidentally committed to the repository.

## Test Database Setup Flow

```
1. scripts/setup-test-env.sh runs:
   a. psql -c "CREATE DATABASE nipp_test;" (if not exists)
   b. npx prisma generate
   c. npx prisma db push --accept-data-loss
   d. npm run db:seed (with TEST env vars set)

2. docker-compose.test.yml starts:
   a. PostgreSQL container (port 5432)
   b. pgbouncer container (port 6432, pointing to PostgreSQL)

3. Next.js server starts:
   a. DATABASE_URL points to pgbouncer (port 6432) or directly to PostgreSQL
   b. next dev (or next start for faster startup)

4. Tests run:
   a. Playwright E2E tests → hit live server
   b. Vitest unit tests → connect directly to test database

5. scripts/teardown-test-env.sh runs:
   a. Drop nipp_test database
```

## Test Data Model (Seeded)

### Platform Organization (Super Admin)
| Field | Value |
|-------|-------|
| Name | Platform (Super Admin) |
| Slug | platform |
| Status | ACTIVE |

### Super Admin User
| Field | Value |
|-------|-------|
| Email | `TEST_ADMIN_EMAIL` (default: `superadmin@example.com`) |
| Password | `TEST_ADMIN_PASSWORD` (default: `SuperAdmin123!`) |
| Role | Super Admin (Platform Organization member) |

### OrgA — Acme Properties Ltd
| Field | Value |
|-------|-------|
| Name | Acme Properties Ltd |
| Slug | acme-properties-ltd |
| Status | ACTIVE |

### OrgA Tenant User
| Field | Value |
|-------|-------|
| Email | `TEST_TENANT_A_EMAIL` (default: `orga-tenant@example.com`) |
| Password | `TEST_TENANT_A_PASSWORD` (default: `TenantA123!`) |
| Role | member (OrgA) |

### OrgB — Belfast Rentals
| Field | Value |
|-------|-------|
| Name | Belfast Rentals |
| Slug | belfast-rentals |
| Status | ACTIVE |

### OrgB Tenant User
| Field | Value |
|-------|-------|
| Email | `TEST_TENANT_B_EMAIL` (default: `orgb-tenant@example.com`) |
| Password | `TEST_TENANT_B_PASSWORD` (default: `TenantB123!`) |
| Role | member (OrgB) |

## E2E Test Structure (Playwright)

### `super-admin-exclusivity.spec.ts`
```
Test Suite: Super Admin Exclusivity

Scenario 1: Tenant user cannot access /admin/organizations
  - Login as OrgA tenant user
  - Navigate to /admin/organizations
  - Expect: 403 response or AccessDenied page

Scenario 2: Tenant user cannot access /admin/permissions
  - Login as OrgA tenant user
  - Navigate to /admin/permissions
  - Expect: 403 response or AccessDenied page

Scenario 3: Tenant user cannot access /admin/system-logs
  - Login as OrgA tenant user
  - Navigate to /admin/system-logs
  - Expect: 403 response or AccessDenied page

Scenario 4: Admin nav links hidden for tenant user
  - Login as OrgA tenant user
  - Check navigation bar
  - Expect: No "Organizations", "Permissions", "Audit Log" links visible

Scenario 5: Super Admin can access all /admin/* routes
  - Login as Super Admin
  - Navigate to each /admin/* route
  - Expect: 200 response, page renders correctly
```

### `cross-tenant-isolation.spec.ts`
```
Test Suite: Cross-Tenant Isolation

Scenario 1: OrgA tenant cannot see OrgB members via API
  - Login as OrgA tenant user
  - GET /api/organizations/[orgB-id]/members (or equivalent)
  - Expect: Empty list or 403

Scenario 2: OrgA tenant cannot see OrgB roles via API
  - Login as OrgA tenant user
  - GET /api/organizations/[orgB-id]/roles (or equivalent)
  - Expect: Empty list or 403

Scenario 3: OrgA tenant sees only own org data in UI
  - Login as OrgA tenant user
  - Navigate to dashboard/home page
  - Expect: Only OrgA data visible, no OrgB references

Scenario 4: Tenant context correctly scoped per request
  - Login as OrgA tenant user
  - Make multiple API requests
  - Expect: All queries scoped to OrgA (verified via audit log or DB inspection)
```

### `super-admin-tenant-access.spec.ts`
```
Test Suite: Super Admin Tenant Data Access

Scenario 1: Super Admin can view OrgA members
  - Login as Super Admin
  - GET /api/admin/organizations/[orgA-id]/members
  - Expect: List of OrgA members returned

Scenario 2: Super Admin can view OrgB members
  - Login as Super Admin
  - GET /api/admin/organizations/[orgB-id]/members
  - Expect: List of OrgB members returned

Scenario 3: Super Admin can add member to OrgA
  - Login as Super Admin
  - POST /api/admin/organizations/[orgA-id]/members { email, role }
  - Expect: New member created in OrgA

Scenario 4: Super Admin can update org settings for any tenant
  - Login as Super Admin
  - PATCH /api/admin/organizations/[orgA-id]/settings { name: "New Name" }
  - Expect: OrgA name updated

Scenario 5: Super Admin can suspend any tenant org
  - Login as Super Admin
  - PATCH /api/admin/organizations/[orgA-id]/status { status: SUSPENDED }
  - Expect: OrgA status changed to SUSPENDED
```

## Application-Layer Test Structure (Vitest)

### `tenant-db.test.ts`
```
Test Suite: Tenant DB Prisma Extension

Scenario 1: Queries are scoped to current organization
  - Set tenant context to OrgA via runWithTenant(orgA.id, ...)
  - Query members model
  - Expect: Only OrgA members returned

Scenario 2: Queries without tenant context throw error
  - No tenant context set
  - Query members model via tenantDb
  - Expect: Error thrown ("No tenant context active")

Scenario 3: Cross-tenant read blocked
  - Set tenant context to OrgA via runWithTenant(orgA.id, ...)
  - Attempt to query OrgB members
  - Expect: Only OrgA members returned (OrgB filtered out)

Scenario 4: Cross-tenant write blocked
  - Set tenant context to OrgA via runWithTenant(orgA.id, ...)
  - Attempt to create member with OrgB's orgId
  - Expect: Query scoped to OrgA (orgId overridden)
```

### `tenant-context.test.ts`
```
Test Suite: Tenant Context AsyncLocalStorage

Scenario 1: runWithTenant sets and propagates orgId
  - Call runWithTenant(orgA.id, () => getCurrentOrgId())
  - Expect: Returns orgA.id

Scenario 2: getCurrentOrgId returns null outside context
  - Call getCurrentOrgId() without runWithTenant
  - Expect: Returns null

Scenario 3: Nested runWithTenant uses innermost context
  - Outer: runWithTenant(orgA.id, ...)
    Inner: runWithTenant(orgB.id, () => getCurrentOrgId())
  - Expect: Returns orgB.id (innermost wins)

Scenario 4: Context does not leak across async boundaries
  - Set context to OrgA
  - Start async operation, switch context to OrgB before awaiting
  - Expect: Inner operation sees OrgB, outer sees OrgA
```

### `global-db-guard.test.ts`
```
Test Suite: Global DB Guard

Scenario 1: getGlobalDb() throws outside super-admin context
  - No super-admin context set
  - Call getGlobalDb()
  - Expect: Error thrown ("globalDb accessed outside super-admin context")

Scenario 2: getGlobalDb() returns client inside super-admin context
  - Set super-admin context via superAdminStorage.run(true, ...)
  - Call getGlobalDb()
  - Expect: Returns PrismaClient instance

Scenario 3: Super-admin context does not leak across requests
  - Set super-admin context in one async scope
  - In a different async scope, call getGlobalDb()
  - Expect: Error thrown (context not leaked)
```

## Docker Compose Test Infrastructure (`docker-compose.test.yml`)

```yaml
version: '3.8'
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: nipp_test
      POSTGRES_USER: ${DB_USER:-nipp}
      POSTGRES_PASSWORD: ${DB_PASS:-nipp_test_pass}
    ports:
      - "5432:5432"
    volumes:
      - postgres_test_data:/var/lib/postgresql/data

  pgbouncer:
    image: edoburu/pgbouncer:latest
    environment:
      DATABASE_URL: postgresql://${DB_USER:-nipp}:${DB_PASS:-nipp_test_pass}@postgres:5432/nipp_test
      POOL_MODE: transaction
      MAX_CLIENT_CONN: 100
      DEFAULT_POOL_SIZE: 20
    ports:
      - "6432:6432"
    depends_on:
      - postgres

volumes:
  postgres_test_data:
```

## Property NI Design System Reference

### Test Data Colors (for test UI verification)
- **Navy Blue:** `#1B2A4A` (Headers, navigation bars)
- **Amber/Gold:** `#F5A623` (Primary buttons, CTAs)

### Test Page Patterns
- Tables: Verify column headers and data rendering
- Forms: Verify input fields, validation messages, submit buttons
- Navigation: Verify link visibility/hidden state based on user role
