# Tenant Isolation Testing

## Overview

Tenant isolation tests verify that no tenant can access another tenant's data, at every layer of the application. These tests are critical because a tenant isolation failure is a catastrophic security vulnerability.

## Test Layers

### Application-Layer Tests (`tests/isolation/application/`)

Test the Prisma Extension, AsyncLocalStorage context propagation, and global DB guard using Vitest.

**Files:**
- `tenant-db.test.ts` — Prisma Extension query scoping
- `tenant-context.test.ts` — AsyncLocalStorage orgId propagation
- `global-db-guard.test.ts` — Super Admin runtime guard

### E2E Tests (`tests/isolation/e2e/`)

Test full request/response cycles against a live Next.js server with real PostgreSQL + pgbouncer using Playwright.

**Files:**
- `super-admin-exclusivity.spec.ts` — Tenant users get 403 on `/admin/*`; Super Admin can access all
- `cross-tenant-isolation.spec.ts` — OrgA cannot see OrgB data via API or UI
- `super-admin-tenant-access.spec.ts` — Super Admin can view/modify any tenant's data

### Database-Layer Tests (`tests/isolation/database/`)

Test PostgreSQL Row Level Security (RLS) by executing raw SQL queries that bypass application-layer scoping. Templates are in place; RLS policies must be added first (deferred).

## Running Tests

See [ISOLATION_TEST_STRATEGY.md](../../ISOLATION_TEST_STRATEGY.md) for full setup instructions and troubleshooting.

```bash
# Full pipeline (setup → app tests → E2E tests → teardown)
npm run test:isolation

# Application-layer tests only (Vitest, no server needed)
npm run test:isolation:app

# E2E tests only (Playwright, requires running server)
npm run test:isolation:e2e

# Setup only (create DB + seed)
npm run test:isolation:setup

# Teardown only (drop DB + stop containers)
npm run test:isolation:teardown

# Individual files
npx vitest run tests/isolation/application/tenant-context.test.ts
npx playwright test tests/isolation/e2e/super-admin-exclusivity.spec.ts
```

## Adding New Tests

When adding a new feature that touches organization-scoped data:

1. Add application-layer isolation tests in `tests/isolation/application/`
2. Add E2E tests in `tests/isolation/e2e/` for auth/UI flows
3. Add database-layer RLS tests in `tests/isolation/database/` (when RLS policies are added)
4. A failure in tenant isolation tests MUST block the PR from merging
