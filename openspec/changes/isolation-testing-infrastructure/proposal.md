# Proposal: Isolation Testing Infrastructure

## Intent
Establish a comprehensive isolation testing infrastructure that verifies tenant data isolation and super admin access controls across the Property NI platform. This includes:

1. **Test database setup** — A dedicated `nipp_test` PostgreSQL database with the same schema as production, seeded with two tenant organizations (`OrgA`, `OrgB`) and their respective tenant users
2. **Integration test framework** — Playwright for browser-level UI + API tests, Vitest for application-layer unit tests
3. **Test infrastructure** — Real PostgreSQL + pgbouncer + Next.js server running locally for tests to execute against
4. **Isolation test suites** — Tests covering super admin exclusivity, cross-tenant isolation, and super admin tenant data access
5. **Strategy documentation** — `ISOLATION_TEST_STRATEGY.md` in the project root

## References & Foundational Rules
This proposal builds upon and must strictly adhere to the rules, design system, and infrastructure established in:

- **`project-initialization`**: Core architecture, tenant isolation strategy (Prisma Extension + RLS), BetterAuth setup, version pinning, and secrets management.
- **`basic-authentication-login-flow`**: Login flow, session management, cookie handling (dot and dash variants), logout mechanics.
- **`auth-and-rbac`**: RBAC engine, Platform Organization security, session augmentation.
- **`super-admin-org-mgmt`**: Super Admin dashboard, global DB client, `requireSuperAdmin()` guards.
- **`super-admin-tenant-management`**: New tenant management API endpoints and UI pages (concurrent proposal).

**Mandatory Rules Enforced:**
- **Unified Architecture:** Single Next.js origin. No separate backend servers.
- **Version Pinning:** Node.js 22 LTS, Next.js 15, React 19, Vitest 4.x.
- **Database & ORM:** PostgreSQL only, Prisma ORM.
- **Tenant Isolation:** `organizationId` is mandatory on all organization-scoped models. The defense-in-depth strategy (Prisma Extension + RLS) must not be bypassed except through explicitly guarded Super Admin pathways.
- **Secrets Management:** No real secrets committed to GitHub. Use `.env.example` for new variables.
- **Test-Driven Completeness:** No code is considered "done" without passing tests. Every new library function, API route, and UI component must have corresponding unit tests. Integration tests must verify end-to-end flows.

## Non-Regression Requirements
This proposal MUST NOT break any functionality established in previous proposals:
- **Auth:** Cookie clearing, database session invalidation, full page reload on logout.
- **AuthZ:** Permission resolution with Redis caching, session augmentation.
- **Project:** Prisma Extension tenant isolation, additive/non-destructive migrations.

## Scope

**In Scope:**
1. **Test Database Setup** — New PostgreSQL database `nipp_test` with:
   - Same Prisma schema as production/dev
   - Seeded with OrgA ("Acme Properties Ltd") and OrgB ("Belfast Rentals")
   - Each org has a standard tenant user for testing
   - Seeded via `npx prisma generate`, `npx prisma db push`, `npm run db:seed`
   - Fresh database created per test run (clean state)
2. **Test Environment Configuration** — Environment variables for test credentials:
   - `TEST_ADMIN_EMAIL` / `TEST_ADMIN_PASSWORD` — Super admin credentials
   - `TEST_TENANT_A_EMAIL` / `TEST_TENANT_A_PASSWORD` — OrgA tenant user
   - `TEST_TENANT_B_EMAIL` / `TEST_TENANT_B_PASSWORD` — OrgB tenant user
   - `DATABASE_URL` — Points to `nipp_test` database
3. **Test Infrastructure** — Docker Compose or local scripts to spin up:
   - PostgreSQL database server
   - pgbouncer connection pooler (as required in dev env)
   - Next.js development server (`next dev`)
4. **Integration Tests (Playwright)** — Browser-level tests:
   - Super admin login → access `/admin/*` routes → verify success
   - Tenant user login → attempt to access `/admin/*` routes → verify 403
   - Tenant user login → navigate to tenant org data → verify only own org data visible
   - Super admin logs in → navigates to tenant org detail page → verifies ability to view/modify tenant data
   - UI components (`<RequireSuperAdmin>`) hide admin nav links for non-super-admins
5. **Application-Layer Tests (Vitest)** — Direct library tests:
   - `lib/tenant-db.ts` — Prisma extension auto-scopes queries to current org
   - `lib/tenant-context.ts` — AsyncLocalStorage propagates org context correctly
   - `lib/global-db-guard.ts` — Throws when accessed outside super-admin context
   - Cross-tenant isolation: OrgA user's queries return only OrgA data
6. **Strategy Documentation** — `ISOLATION_TEST_STRATEGY.md` in project root covering:
   - Overall isolation testing strategy
   - Test environment setup instructions
   - How to run tests
   - Adding new isolation tests

**Out of Scope (Deferred):**
- Database-layer RLS tests (require RLS policies to be added first — covered in a future proposal)
- Performance/load testing for isolation boundaries
- Automated test infrastructure (CI/CD pipeline integration — separate effort)

## Files to Create or Modify

| Type | File Path | Purpose |
|------|-----------|---------|
| New | `ISOLATION_TEST_STRATEGY.md` | Strategy documentation for isolation testing |
| New | `.env.test.example` | Example test environment variables |
| Modified | `prisma/seed.ts` | Add OrgA and OrgB seeding for test database (also in super-admin-tenant-management) |
| New | `tests/isolation/playwright.config.ts` | Playwright configuration for isolation tests |
| New | `tests/isolation/e2e/super-admin-exclusivity.spec.ts` | E2E tests for super admin access control |
| New | `tests/isolation/e2e/cross-tenant-isolation.spec.ts` | E2E tests for cross-tenant data isolation |
| New | `tests/isolation/e2e/super-admin-tenant-access.spec.ts` | E2E tests for super admin tenant data access |
| New | `tests/isolation/application/tenant-db.test.ts` | Unit tests for tenant-db Prisma extension |
| New | `tests/isolation/application/tenant-context.test.ts` | Unit tests for tenant-context AsyncLocalStorage |
| New | `tests/isolation/application/global-db-guard.test.ts` | Unit tests for global-db-guard runtime guard |
| New | `scripts/setup-test-env.sh` | Script to create nipp_test DB and run seed |
| New | `scripts/teardown-test-env.sh` | Script to drop nipp_test DB after tests |
| New | `docker-compose.test.yml` | Docker Compose for PostgreSQL + pgbouncer test infrastructure |

## Testing Plan

- **Playwright E2E tests** run against a live Next.js server with real PostgreSQL + pgbouncer
- **Vitest unit tests** run against the test database directly (no server needed)
- **Test isolation**: Each test file gets a fresh database state (truncate between suites)
- **Parallel execution**: Playwright tests run in parallel across browsers; Vitest tests run in parallel by file
- **CI-ready**: All test commands must work identically locally and in CI

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Test database state leaking between test runs | High | Fresh DB created per run; truncate tables between suites |
| pgbouncer connection pool exhaustion during tests | Medium | Configure max connections appropriately; use connection limits in test config |
| Tests flakiness due to async timing | Medium | Use Playwright's auto-waiting; add explicit waits for DB operations |
| Test credentials accidentally committed to repo | Critical | `.env.test` in `.gitignore`; only `.env.test.example` committed with placeholder values |
| Test suite slow due to full server startup | Medium | Cache Docker images; use `next build` + `next start` for faster startup in CI |

## Acceptance Criteria

- [ ] Test database `nipp_test` can be created and seeded via scripts
- [ ] Playwright E2E tests run successfully against a live server with real PostgreSQL + pgbouncer
- [ ] Vitest application-layer tests run successfully against the test database
- [ ] Super admin exclusivity verified: tenant user gets 403 on `/admin/*` routes
- [ ] Super admin exclusivity verified: `<RequireSuperAdmin>` hides admin nav for tenant users
- [ ] Cross-tenant isolation verified: OrgA user cannot see OrgB data via API or UI
- [ ] Super admin tenant access verified: Super Admin can view and modify OrgA data
- [ ] `ISOLATION_TEST_STRATEGY.md` exists in project root with setup instructions
- [ ] All tests can be run via a single command (`npm test:isolation`)
