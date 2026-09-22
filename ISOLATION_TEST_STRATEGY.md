# Isolation Test Strategy

## Overview

This document describes the isolation testing strategy for the Property NI Multi-Tenant Portal. Tenant isolation is a critical security boundary — a failure allows one tenant to access another tenant's data, which is a catastrophic vulnerability.

The strategy uses a **defense-in-depth** approach with three complementary test layers:

1. **Application-Layer Tests (Vitest)** — Direct tests of the Prisma extension (`tenantDb`) and AsyncLocalStorage context propagation. The unscoped `globalDb` client it used to guard is deleted (Phase 3B); the structural guarantee lives in `global-db-removed.test.ts`.
2. **Database-Layer Tests (Vitest + raw pg)** — RLS probes that execute raw SQL as the non-owner `nipp_app` role against a freshly migrated scratch DB, verifying every policy independent of any app code (`tests/isolation/database/`, design §5.1).
3. **End-to-End Tests (Playwright)** — Browser-level tests against a live Next.js server with real PostgreSQL + pgbouncer, exercising BOTH layers at once.

## Test Layers

### Layer 1: Application-Layer Tests (Vitest)

Tests the core isolation mechanisms directly, without going through the HTTP layer.

**What is tested:**
- `lib/tenant-db.ts` — Prisma `$extends` chain auto-scopes queries to the current organization (incl. count/aggregate/groupBy); fails closed without context; platform-admin contexts pass through to RLS
- `lib/tenant-context.ts` — AsyncLocalStorage propagates the verified `(userId, orgId, isPlatformAdmin)` context through async call chains
- model coverage drift guard — `TENANT_SCOPED_MODELS` must match the schema's required-org-column models exactly (`tests/unit/tenant-db-hardening.test.ts`)

**Test pattern:**
1. Create test data for two organizations (OrgA and OrgB) in the test database
2. Set tenant context to OrgA using `runWithTenantContext({userId, orgId: orgA.id, isPlatformAdmin}, ...)` (or via the route-boundary `withRLSContext` for request shapes)
3. Query the model — expect only OrgA data
4. Set tenant context to OrgB
5. Query the same model — expect only OrgB data

**Location:** `tests/isolation/application/`

### Layer 2: Database-Layer Tests (Vitest + raw pg) — RLS

Tests PostgreSQL Row Level Security independently of any application code. The suite creates a SCRATCH database (`nipp_rls_test`), applies the full migration chain, seeds a deterministic two-tenant + platform fixture as owner, then probes RLS as `nipp_app` with GUCs set via parameterized transaction-local `set_config` — the same binding shape the app uses (`lib/rls-transaction.ts`) but driven from raw SQL.

**What is tested:**
- `rls-org-scoped.spec.ts` — per org table: own-org rows visible, foreign-org rows invisible; writes bound to ctx (WITH CHECK denies foreign-org inserts; UPDATE/DELETE of foreign rows silently denied)
- `rls-platform-admin.spec.ts` — flag=1 cross-tenant reads; writes still ctx-bound (foreign-org insert/update violate RLS); Organization per-command posture (admin-only mutability, acting ON the target org); Notification ack path
- `rls-audit-append-only.spec.ts` — AuditLog/NotificationLog have NO update/delete policy (meta-check via `pg_policies`); cross-tenant SELECT only with flag=1; NULL-org global rows visible to all
- `rls-job-definition-platform-only.spec.ts` — job tables invisible to any tenant ctx and to flag-without-platformOrgId; full access with the verified platform context
- `rls-context-probe.spec.ts` — NO GUCs → zero rows on every org-scoped table (fail-closed posture), with the documented global-row exceptions
- `migrations-ownership.spec.ts` — no public table owned by `nipp_app`; RLS-enabled count = 18; live policy catalog hash == committed golden file (drift blocks merge)

**Location:** `tests/isolation/database/` — run with `npm run test:isolation:db` (needs a reachable owner DSN + `NIPP_APP_DB_PASSWORD`; in CI it uses the `rls-db-tests` job's postgres:16 service).

### Layer 3: End-to-End Tests (Playwright)

Tests the full request/response cycle through a live browser, verifying that isolation holds at every layer (middleware → API route → both isolation layers in the database).

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
# One-command full run (setup → DB-layer RLS → tests → teardown)
npm run test:isolation

# Database-layer RLS suite alone (any reachable Postgres with the owner DSN;
# CI uses its dedicated postgres:16 service + NIPP_APP_DB_PASSWORD secret)
npm run test:isolation:db

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
   - Use `runWithTenantContext({userId, orgId, isPlatformAdmin}, fn)` to set the verified tenant context
   - Use `tenantDb` for scoped queries (never a raw client)
   - For platform-admin operations use the `lib/platform-db.ts` wrappers — an unscoped client no longer exists (`globalDb` was deleted in Phase 3B)
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

### Database-Layer Tests (Vitest + raw pg — RLS)

1. Create a new `*.spec.ts` file in `tests/isolation/database/`
2. Reuse the shared fixture: `prepareDatabase()` from `./rls-fixture` (fresh scratch DB, full migration chain, deterministic two-tenant seed as owner)
3. Probe as the non-owner role with `appClient()` + `withGucTxn(client, gucs, fn)` — GUCs are set transaction-locally via parameterized `set_config($1,$2,true)`, exactly like the app's binding; every probe txn rolls back so the fixture stays intact
4. Execute raw SQL and assert RLS visibility/denial per the policy catalog (`tests/isolation/database/policy-catalog.golden`)
5. If you change a migration's policies: regenerate the golden with `npm run db:gen-policy-golden` and commit both

Run with: `npm run test:isolation:db`. A failure MUST block merge (release-blocking by policy).

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
