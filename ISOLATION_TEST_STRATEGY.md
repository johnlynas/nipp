# Isolation Test Strategy

## Overview

This document describes the isolation testing strategy for the Property NI Multi-Tenant Portal. Tenant isolation is a critical security boundary — a failure allows one tenant to access another tenant's data, which is a catastrophic vulnerability.

The strategy uses a **defense-in-depth** approach with two complementary test layers:

1. **Application-Layer Tests (Vitest)** — Direct tests of the Prisma extension, AsyncLocalStorage context propagation, and global DB guard
2. **End-to-End Tests (Playwright)** — Browser-level tests against a live Next.js server with real PostgreSQL + pgbouncer

## Test Layers

### Layer 1: Application-Layer Tests (Vitest)

Tests the core isolation mechanisms directly, without going through the HTTP layer.

**What is tested:**
- `lib/tenant-db.ts` — Prisma `$extends` extension auto-scopes queries to the current organization
- `lib/tenant-context.ts` — AsyncLocalStorage propagates `organizationId` through async call chains
- `lib/global-db-guard.ts` — Runtime guard throws when `getGlobalDb()` is called outside a super-admin context

**Test pattern:**
1. Create test data for two organizations (OrgA and OrgB) in the test database
2. Set tenant context to OrgA using `runWithTenant(orgA.id, ...)`
3. Query the model — expect only OrgA data
4. Set tenant context to OrgB
5. Query the same model — expect only OrgB data

**Location:** `tests/isolation/application/`

### Layer 2: End-to-End Tests (Playwright)

Tests the full request/response cycle through a live browser, verifying that isolation holds at every layer (middleware → API route → database).

**What is tested:**
- Super admin exclusivity — regular tenant users get 403 on `/admin/*` routes
- Cross-tenant isolation — OrgA user cannot see OrgB data via API or UI
- Super admin tenant access — Super Admin can view and modify any tenant org's data
- UI rendering — `<RequireSuperAdmin>` hides admin nav links for non-super-admins

**Test pattern:**
1. Spin up PostgreSQL + pgbouncer + Next.js server against the test database
2. Log in as a specific user (tenant or super admin) via browser
3. Navigate to the target page or call the target API endpoint
4. Assert on response status, page content, or data returned

**Location:** `tests/isolation/e2e/`

### Layer 3: Database-Layer Tests (Future)

PostgreSQL Row Level Security (RLS) tests that execute raw SQL queries to verify the database-level isolation boundary. These require RLS policies to be added first (deferred until business data models exist).

**Location:** `tests/isolation/database/` (templates in place)

## Test Environment Setup

### Prerequisites

- **Node.js 22 LTS** — Pinned via `.nvmrc`
- **PostgreSQL 16** — Installed locally or available via Docker
- **Docker + Docker Compose** — For running PostgreSQL and pgbouncer containers
- **pgbouncer** — Connection pooler (required in test env, same as dev env)
- **Playwright browsers** — `npx playwright install`

### Database Setup

The test uses a dedicated PostgreSQL database called `nipp_test`. This database is created fresh for each test run to ensure clean state.

**Setup script:** `scripts/setup-test-env.sh`

```bash
# Full setup (creates DB, runs Prisma generate/push/seed)
./scripts/setup-test-env.sh

# Or use npm scripts:
npm run test:isolation:setup
```

**Teardown script:** `scripts/teardown-test-env.sh`

```bash
# Drop the test database
./scripts/teardown-test-env.sh

# Or use npm scripts:
npm run test:isolation:teardown
```

### Environment Variables

Create a `.env.test` file in the project root with the following variables:

```bash
# Test database connection (points to pgbouncer on port 6433)
DATABASE_URL=postgresql://nipp:nipp_test_pass@localhost:6433/nipp_test?pgbouncer=true

# Test super admin credentials
TEST_ADMIN_EMAIL=superadmin@example.com
TEST_ADMIN_PASSWORD=SuperAdmin123!

# Test tenant user credentials (OrgA)
TEST_TENANT_A_EMAIL=orga-tenant@example.com
TEST_TENANT_A_PASSWORD=TenantA123!

# Test tenant user credentials (OrgB)
TEST_TENANT_B_EMAIL=orgb-tenant@example.com
TEST_TENANT_B_PASSWORD=TenantB123!

# PostgreSQL connection (for setup script, before pgbouncer)
DB_USER=nipp
DB_PASS=nipp_test_pass
```

**Important:** `.env.test` is in `.gitignore`. Only `.env.test.example` (with placeholder values) is committed to the repository.

### Infrastructure Startup

```bash
# Start PostgreSQL + pgbouncer via Docker Compose
docker compose -f docker-compose.test.yml up -d

# Verify services are running
docker compose -f docker-compose.test.yml ps
```

### Full Test Run

```bash
# One-command full run (setup → tests → teardown)
npm run test:isolation

# Or granular control:
docker compose -f docker-compose.test.yml up -d          # Start infra
./scripts/setup-test-env.sh                               # Create DB + seed
next dev                                                  # Start server (in another terminal)
npm test -- tests/isolation/application/                   # Run Vitest app-layer tests
npx playwright test                                       # Run Playwright E2E tests
./scripts/teardown-test-env.sh                            # Clean up DB
docker compose -f docker-compose.test.yml down            # Stop infra
```

## Test Data Model

The test database is seeded with the following data:

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

## Running Tests

### All Isolation Tests

```bash
npm run test:isolation
```

This runs the full pipeline: setup → app-layer tests → E2E tests → teardown.

### Application-Layer Tests Only (Vitest)

```bash
npm test -- tests/isolation/application/
```

These tests connect directly to the test database and do not require a running Next.js server. They are fast (~5-10 seconds).

### E2E Tests Only (Playwright)

```bash
npm run test:isolation:e2e
# or
npx playwright test tests/isolation/e2e/
```

These tests require a running Next.js server, PostgreSQL, and pgbouncer. They are slower (~2-5 minutes).

### Single Test File

```bash
# Vitest
npm run test:isolation:app -- tests/isolation/application/tenant-db.test.ts
# or
npx vitest run tests/isolation/application/tenant-db.test.ts

# Playwright
npm run test:isolation:e2e -- tests/isolation/e2e/super-admin-exclusivity.spec.ts
# or
npx playwright test tests/isolation/e2e/super-admin-exclusivity.spec.ts
```

### Single Test Scenario

```bash
# Playwright (filter by test name)
npx playwright test --grep="Tenant user cannot access /admin/organizations"
```

## Adding New Isolation Tests

### Application-Layer Tests (Vitest)

1. Create a new file in `tests/isolation/application/`
2. Import the library function you want to test
3. Set up test data in the `nipp_test` database using Prisma
4. Write tests following the established patterns:
   - Use `runWithTenant(orgId, fn)` to set tenant context
   - Use `tenantDb` for scoped queries
   - Use `globalDb` with `superAdminStorage.run(true, ...)` for super-admin operations
5. Run with: `npm test -- tests/isolation/application/<your-file>.test.ts`

### E2E Tests (Playwright)

1. Create a new file in `tests/isolation/e2e/`
2. Import Playwright's test fixtures: `import { test, expect } from '@playwright/test'`
3. Write tests following the established patterns:
   - Use `page.goto()` for navigation
   - Use `page.getByRole()`, `page.getByLabel()` for element selection (accessibility-first)
   - Use `expect(response).toBeOK()` or `expect(response.status()).toBe(403)` for API assertions
   - Use `expect(page).toHaveURL(...)` for navigation verification
4. Run with: `npx playwright test tests/isolation/e2e/<your-file>.spec.ts`

### Database-Layer Tests (Future — RLS)

1. Create a new file in `tests/isolation/database/`
2. Use raw SQL queries via the test database connection
3. Set session variable: `SELECT set_config('app.current_org_id', '<orgId>', true)`
4. Execute queries and verify RLS policies enforce isolation

## Troubleshooting

### Test database connection fails

```bash
# Check if PostgreSQL is running
docker compose -f docker-compose.test.yml ps

# Check pgbouncer logs
docker compose -f docker-compose.test.yml logs pgbouncer

# Verify DATABASE_URL in .env.test points to the correct host/port
cat .env.test | grep DATABASE_URL
```

### Prisma schema mismatch

```bash
# Regenerate Prisma client
npx prisma generate

# Push schema changes to test database
npx prisma db push --accept-data-loss
```

### Playwright tests fail with "browser not found"

```bash
# Install Playwright browsers
npx playwright install
```

### Tests fail due to stale test data

```bash
# Full teardown and setup
npm run test:isolation:teardown
npm run test:isolation:setup
```

### pgbouncer connection limit reached

```bash
# Increase MAX_CLIENT_CONN in docker-compose.test.yml
# Then restart:
docker compose -f docker-compose.test.yml down
docker compose -f docker-compose.test.yml up -d
```

## Security Considerations

- **Test credentials are never committed to git** — `.env.test` is in `.gitignore`
- **Test database is isolated from dev/prod** — Separate database name (`nipp_test`)
- **Test data is disposable** — Database is dropped after each full test run
- **No real user data in tests** — All test users have `@example.com` email addresses
- **Isolation failures block PRs** — A failure in isolation tests MUST prevent merging

## Related Documents

- `openspec/changes/super-admin-tenant-management/proposal.md` — Super admin tenant management feature
- `openspec/changes/isolation-testing-infrastructure/proposal.md` — Isolation testing infrastructure proposal
- `openspec/changes/project-initialization/specs/multi-tenancy/spec.md` — Multi-tenancy specification
- `SECURITY.md` — Security conventions and RBAC model
- `ARCHITECTURE.md` — System architecture and data flow
