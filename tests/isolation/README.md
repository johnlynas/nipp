# Tenant Isolation Testing

## Overview

Tenant isolation tests verify that no tenant can access another tenant's data, at every layer of the application. These tests are critical because a tenant isolation failure is a catastrophic security vulnerability.

## Test Layers

### Application-Layer Tests (`tests/isolation/application/`)

Test the Prisma extension, AsyncLocalStorage context propagation, and the structural removal of the unscoped client using Vitest.

**Files:**
- `tenant-db.test.ts` — Prisma Extension query scoping
- `tenant-context.test.ts` — AsyncLocalStorage (userId/orgId/isPlatformAdmin) propagation
- `team-isolation.test.ts` / `calendar-isolation.test.ts` — two-tenant service flows
- `global-db-removed.test.ts` — asserts the unscoped `globalDb` client + TS guard stay **deleted** (Phase 3B)
- Model coverage drift guard: `tests/unit/tenant-db-hardening.test.ts` (unit suite)

### Database-Layer Tests (`tests/isolation/database/`)

Test PostgreSQL Row Level Security by executing raw SQL as the non-owner `nipp_app` role — independently of any application code. The shared fixture (`rls-fixture.ts`) drops/creates a scratch DB, applies the full migration chain, seeds two tenants + a platform org as owner; probes set GUCs transaction-locally via parameterized `set_config($1,$2,true)` and roll back on exit.

**Files:**
- `rls-org-scoped.spec.ts` — own-org visible / foreign-org invisible; writes ctx-bound (WITH CHECK)
- `rls-platform-admin.spec.ts` — flag=1 cross-tenant reads; Organization per-command posture; admin writes still ctx-bound
- `rls-audit-append-only.spec.ts` — AuditLog/NotificationLog append-only (no update/delete policy) + NULL-org visibility
- `rls-job-definition-platform-only.spec.ts` — job tables require flag AND `app.platform_org_id` match
- `rls-context-probe.spec.ts` — no GUCs → zero tenant rows (fail-closed posture)
- `migrations-ownership.spec.ts` — ownership/RLS-count invariants + policy catalog hash vs `policy-catalog.golden`

Run: `npm run test:isolation:db` (needs owner DSN via `DATABASE_URL` or `.env`, plus `NIPP_APP_DB_PASSWORD`). Regenerate the golden after a policy migration change: `npm run db:gen-policy-golden`.

### E2E Tests (`tests/isolation/e2e/`)

Test full request/response cycles against a live Next.js server with real PostgreSQL + pgbouncer using Playwright — exercising BOTH isolation layers at once.

**Files:**
- `super-admin-exclusivity.spec.ts` — Tenant users get 403 on `/admin/*`; Super Admin can access all
- `cross-tenant-isolation.spec.ts` — OrgA cannot see OrgB data via API or UI
- `super-admin-tenant-access.spec.ts` — Super Admin can view/modify any tenant's data (verified RLS flag context)

## Running Tests

See [ISOLATION_TEST_STRATEGY.md](../../ISOLATION_TEST_STRATEGY.md) for full setup instructions and troubleshooting.

```bash
# Full pipeline (DB-layer RLS → setup → app tests → E2E tests → teardown)
npm run test:isolation

# DB-layer RLS suite only (any reachable Postgres; blocks merge on failure)
npm run test:isolation:db

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
npx vitest run tests/isolation/database/rls-context-probe.spec.ts --config vitest.db.config.ts
npx playwright test tests/isolation/e2e/super-admin-exclusivity.spec.ts
```

## Adding New Tests

When adding a new feature that touches organization-scoped data:
1. Add application-layer isolation tests in `tests/isolation/application/`
2. If the model is org-scoped, confirm it's covered by both layers: `TENANT_SCOPED_MODELS` (drift-guarded by the unit suite) AND a RLS policy (golden-file drift guard in CI)
3. Add E2E tests in `tests/isolation/e2e/` for auth/UI flows
4. A failure in tenant isolation tests MUST block the PR from merging
