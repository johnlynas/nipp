# Tasks

## 0. Pre-Implementation Verification
- [x] 0.1 Verify Playwright is installed (check `package.json` devDependencies)
- [x] 0.2 Verify Vitest is installed and configured (`vitest.config.ts`)
- [x] 0.3 Verify Docker Compose is available on the development machine
- [x] 0.4 Verify existing `.env.test` (if any) is in `.gitignore`
- [x] 0.5 Verify existing isolation test templates exist at `tests/isolation/application/template.test.ts` and `tests/isolation/database/template.test.ts`

## 1. Test Environment Configuration
- [x] 1.1 Create `.env.test.example` with placeholder values for all test credentials
- [x] 1.2 Ensure `.env.test` is listed in `.gitignore`
- [x] 1.3 Create `scripts/setup-test-env.sh`:
  - Creates `nipp_test` database via `psql`
  - Runs `npx prisma generate`
  - Runs `npx prisma db push --accept-data-loss`
  - Runs `npm run db:seed` with test env vars loaded from `.env.test`
- [x] 1.4 Create `scripts/teardown-test-env.sh`:
  - Drops `nipp_test` database via `psql`
- [x] 1.5 Make both scripts executable (`chmod +x`)
- [x] 1.6 Add `npm test:isolation` script to `package.json` that orchestrates setup → tests → teardown
- [x] 1.7 Add `npm test:isolation:setup` and `npm test:isolation:teardown` scripts for granular control

## 2. Test Infrastructure (Docker Compose)
- [x] 2.1 Create `docker-compose.test.yml` with PostgreSQL + pgbouncer services
- [x] 2.2 Configure pgbouncer for transaction pooling mode
- [x] 2.3 Set max connections to accommodate test parallelism (100 client conn, 20 pool size)
- [x] 2.4 **TEST:** Verify `docker compose -f docker-compose.test.yml up` starts both services
- [x] 2.5 **TEST:** Verify pgbouncer on port 6432 proxies to PostgreSQL on port 5432
- [x] 2.6 **TEST:** Verify `nipp_test` database is accessible via pgbouncer connection string

## 3. Prisma Seed Updates (Test Data)
- [x] 3.1 Update `prisma/seed.ts` to detect test environment (check for `TEST_ADMIN_EMAIL` env var)
- [x] 3.2 When in test mode, create OrgA ("Acme Properties Ltd") with status ACTIVE
- [x] 3.3 When in test mode, create OrgB ("Belfast Rentals") with status ACTIVE
- [x] 3.4 When in test mode, create tenant user for OrgA with email from `TEST_TENANT_A_EMAIL`
- [x] 3.5 When in test mode, create tenant user for OrgB with email from `TEST_TENANT_B_EMAIL`
- [x] 3.6 When in test mode, add both tenant users as members of their respective orgs
- [x] 3.7 When in test mode, ensure default roles exist in both OrgA and OrgB
- [x] 3.8 **TEST:** Run seed against `nipp_test` and verify OrgA, OrgB, and both tenant users exist

## 4. Application-Layer Tests (Vitest)
- [x] 4.1 Create `tests/isolation/application/tenant-db.test.ts`:
  - Test: Queries scoped to current organization
  - Test: Error thrown when no tenant context active
  - Test: Cross-tenant read blocked (OrgA query returns only OrgA data)
  - Test: Cross-tenant write blocked (orgId overridden in create/update)
- [x] 4.2 Create `tests/isolation/application/tenant-context.test.ts`:
  - Test: runWithTenant sets and propagates orgId correctly
  - Test: getCurrentOrgId returns null outside context
  - Test: Nested runWithTenant uses innermost context
  - Test: Context does not leak across async boundaries
- [x] 4.3 Create `tests/isolation/application/global-db-guard.test.ts`:
  - Test: getGlobalDb() throws outside super-admin context
  - Test: getGlobalDb() returns client inside super-admin context
  - Test: Super-admin context does not leak across async scopes
- [x] 4.4 **TEST:** Run `npm test -- tests/isolation/application/` and verify all pass
- [x] 4.5 Remove or repurpose `tests/isolation/application/template.test.ts`

## 5. Playwright Configuration
- [x] 5.1 Create `tests/isolation/playwright.config.ts` with:
  - Base URL pointing to local Next.js server (e.g., `http://localhost:3000`)
  - Test timeout of 30 seconds per test
  - Retry of 1 for flaky tests
  - Workers: 4 (parallel execution)
- [x] 5.2 Configure Playwright to use Chromium browser
- [x] 5.3 **TEST:** Run `npx playwright test --list` and verify all test files are discovered

## 6. E2E Tests — Super Admin Exclusivity
- [x] 6.1 Create `tests/isolation/e2e/super-admin-exclusivity.spec.ts`:
  - Test: Tenant user gets 403 on `/admin/organizations`
  - Test: Tenant user gets 403 on `/admin/permissions`
  - Test: Tenant user gets 403 on `/admin/system-logs`
  - Test: Admin nav links hidden for tenant user (check DOM)
  - Test: Super Admin can access all `/admin/*` routes
- [x] 6.2 **TEST:** Run Playwright test and verify all scenarios pass

## 7. E2E Tests — Cross-Tenant Isolation
- [x] 7.1 Create `tests/isolation/e2e/cross-tenant-isolation.spec.ts`:
  - Test: OrgA tenant cannot see OrgB members via API
  - Test: OrgA tenant cannot see OrgB roles via API
  - Test: OrgA tenant sees only own org data in UI
  - Test: Tenant context correctly scoped per request (verify via audit log)
- [x] 7.2 **TEST:** Run Playwright test and verify all scenarios pass

## 8. E2E Tests — Super Admin Tenant Access
- [x] 8.1 Create `tests/isolation/e2e/super-admin-tenant-access.spec.ts`:
  - Test: Super Admin can view OrgA members via API
  - Test: Super Admin can view OrgB members via API
  - Test: Super Admin can add member to OrgA
  - Test: Super Admin can update org settings for any tenant
  - Test: Super Admin can suspend any tenant org
- [x] 8.2 **TEST:** Run Playwright test and verify all scenarios pass

## 9. Strategy Documentation
- [x] 9.1 Create `ISOLATION_TEST_STRATEGY.md` in project root with:
  - Overview of isolation testing strategy (application-layer + E2E)
  - Test environment setup instructions (Docker, Prisma, env vars)
  - How to run tests (`npm test:isolation`, granular commands)
  - Adding new isolation tests (patterns, conventions)
  - Troubleshooting common issues
- [x] 9.2 Update `tests/isolation/README.md` to reference the new strategy doc

## 10. Integration & End-to-End Verification
- [x] 10.1 **FULL RUN:** Execute `npm test:isolation` end-to-end (setup → all tests → teardown)
- [x] 10.2 **FULL RUN:** Verify all Playwright E2E tests pass
- [x] 10.3 **FULL RUN:** Verify all Vitest application-layer tests pass
- [x] 10.4 **FULL RUN:** Verify test database is properly cleaned up after teardown
- [x] 10.5 **FULL RUN:** Verify tests pass when run in a clean environment (no pre-existing nipp_test DB)
- [x] 10.6 **NON-REGRESSION:** Verify existing dev database (`nipp_dev`) is unaffected by test setup/teardown
