# RLS Complete-Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make PostgreSQL Row Level Security a live, verified second line of defense for every org-scoped table, derived from a server-side-trusted per-request context, with the unscoped-client bypass (`globalDb`) eliminated.

**Architecture:** (1) New DB roles: `nipp_app` (non-owner app role — RLS applies) and owner/migration role; (2) single choke-point that sets 3 GUCs (`app.current_user_id`, `app.current_org_id`, `app.is_platform_admin`) inside the same interactive Prisma transaction as each query; (3) 18-table policy catalog with a boolean platform-admin flag instead of recursive membership sub-queries; (4) database-layer RLS test suite in CI. Full design: `documents/rls-complete-implementation.md`.

**Tech Stack:** Node 22, Next.js 15, Prisma 6, PostgreSQL 15, Vitest, Playwright, plain SQL migrations.

**Prerequisite facts (verified 2026-09-19):** zero live RLS policies in any database; `lib/rls.ts` has zero callers; both RLS migrations never applied (dev DB created via `prisma db push`, no `_prisma_migrations`); ~35 files import `globalDb`; 9 files use `superAdminStorage.run(true, …)`.

---

## Phase 1 — Foundation

### Task 1A: Create DB roles migration

**Objective:** App connects as a non-owner role so RLS actually applies to app traffic.

**Files:**
- Create: `prisma/migrations/<ts>_create_rls_roles/migration.sql`

**Step 1:** Write the migration:

```sql
-- nipp_app: application role. Not owner, cannot bypass RLS.
DO $$ BEGIN
   IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nipp_app') THEN
      CREATE ROLE nipp_app LOGIN NOSUPERUSER NOCREATEDB NOREPLICATION;
   END IF;
END $$;

ALTER ROLE nipp_app PASSWORD FROM current_setting('app.nipp_app_password', true); -- see Step 3

GRANT USAGE ON SCHEMA public TO nipp_app;
-- Grant on existing + future tables (run in migration; future tables covered by default privileges below)
DO $$ DECLARE r RECORD;
BEGIN
   FOR r IN SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relkind='r' LOOP
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %s TO nipp_app',
         format('%I.%I','public',(SELECT relname FROM pg_class WHERE oid=r.oid)));
   END LOOP;
END $$;

-- Migrations/seed (owner role) must continue to work: owner retains full rights by default.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nipp_app;
```

**Step 2:** Wire the password safely — `nipp_app`'s password goes in `.env.example`, `.env.test`, and CI secret as `NIPP_APP_DB_PASSWORD`; the migration reads it via a temporary env-injected setting: run through a small node wrapper script `scripts/apply-roles-migration.ts` that connects as owner, runs `SELECT set_config('app.nipp_app_password', process.env.NIPP_APP_DB_PASSWORD, false)`, then executes the SQL. Add an alternative: `ALTER ROLE nipp_app WITH PASSWORD '<from env>'` inside the wrapper (simpler — **choose this**; drop the `set_config` line from the migration).

**Step 3:** Verify:
```bash
psql "$DIRECT_DATABASE_URL" -c "\du"            # nipp_app exists
psql "postgresql://nipp_app@localhost:5432/nipp_dev" -c "SELECT 1"  # app role connects (after .env swap in Task 1D)
```

**Step 4:** Commit — `feat(db): create non-owner nipp_app role for RLS enforcement`

### Task 1B: Rewrite `lib/rls.ts` → `lib/rls-context.ts`

**Objective:** Pure, single-use GUC setter callable only by the tenant extension.

**Files:**
- Create: `lib/rls-context.ts`
- Delete: `lib/rls.ts` (zero callers — verified)
- Test: `tests/unit/rls-context.test.ts`

**Step 1:** Failing test:

```ts
import { describe, it, expect } from 'vitest';
import { buildRLSContextQueries } from '@/lib/rls-context';

describe('buildRLSContextQueries', () => {
  it('produces one set_config call per GUC, local=true (transaction-scoped)', () => {
    const q = buildRLSContextQueries({ userId: 'u1', orgId: 'org-A', isPlatformAdmin: true });
    expect(q).toEqual([
      "SELECT set_config('app.current_user_id','u1',true), set_config('app.current_org_id','org-A',true), set_config('app.is_platform_admin','1',true)",
    ]);
  });
});
```

**Step 2:** Run `npx vitest run tests/unit/rls-context.test.ts` — expect FAIL (module missing).

**Step 3:** Implement:

```ts
/**
 * RLS context GUC builder. The ONLY place app.current_* variables are set.
 * Must be issued on the same connection as the guarded query — tenant-db.ts
 * issues this inside a Prisma interactive transaction before the query.
 */
export interface RLSContext { userId: string; orgId: string; isPlatformAdmin: boolean }

export function buildRLSContextQueries(c: RLSContext): string {
  const esc = (s: string) => s.replace(/'/g, "''");
  return `SELECT set_config('app.current_user_id', '${esc(c.userId)}', true),
             set_config('app.current_org_id', '${esc(c.orgId)}', true),
             set_config('app.is_platform_admin', '${c.isPlatformAdmin ? '1' : '0'}', true)`;
}
```

**Step 4:** Run test — expect PASS. Commit `feat(rls): GUC context builder, transaction-scoped`.

### Task 1C: Wrap all tenantDb operations in an interactive transaction that sets RLS context

**Objective:** Every query through `tenantDb` runs with verified GUCs on the same connection.

**Files:**
- Modify: `lib/tenant-db.ts` (wrap each model callback's `query(args)` in `$transaction`)
- Test: `tests/isolation/application/tenant-db.test.ts` (extend)

**Step 1:** Add failing test asserting the raw SQL executed contains a `set_config('app.current_org_id',…)` immediately before the model query. In existing tests, mock `$transaction` to capture blocks and assert the block calls set_config first; also add: no tenant context → throws before any transaction is started.

**Step 2:** Run — expect FAIL.

**Step 3:** Implement in `lib/tenant-db.ts`: each `scopeWhere`/`create`/`upsert` resolves `assertTenantContext()`, then:

```ts
async function scopeWhere({ args, query }: ExtensionCallback): Promise<unknown> {
  const orgId = assertTenantContext();
  args.where = { ...(args.where as QueryArgs), [orgField]: orgId };
  return tenantDb.$transaction(async (tx) => {
    // GUCs on tx connection; userId from extended context (Task 1D adds it to store)
    await tx.$executeRawUnsafe(buildRLSContextQueries({ userId: getUserIdForRLS(), orgId, isPlatformAdmin: getIsPlatformAdminForRLS() }));
    return query(args); // NOTE: call original `query` — it runs on the same client; verify connection-pinning (see pitfall below)
  });
}
```

> **Pitfall (verify in this task, not later):** Prisma `$transaction(async (tx) => …)` binds the callback's `tx` to one pooled connection for its duration — GUCs and query share it. But calling *outer-client* `query(args)` inside an interactive transaction runs on a DIFFERENT connection. Correct pattern: replace inner calls with `tx.<model>` equivalents where possible, or run the whole operation as raw-free by issuing the model query via `tx`. Test with the real DB (not mocks): insert two rows in two orgs from one `next dev` session and confirm row filtering under RLS after Phase 2. If per-callback transaction overhead is unacceptable (many round trips), fallback design: single `$transaction` at the *service call boundary* (route calls `withRLS(orgId, platformAdmin)(async tx => service.txCall(tx))`) — decide empirically in this task and record decision in PR description. **Default choice for plan: per-operation transaction** (simplest correctness).

**Step 4:** Run `npm run test && npm run test:isolation:app` — expect PASS. Commit `feat(rls): bind GUC context to queries in shared transactions`.

### Task 1D: Extend tenant context with userId + platform-admin flag; derive at route boundary

**Objective:** Context store carries everything RLS needs; derivation verified server-side.

**Files:**
- Modify: `lib/tenant-context.ts` (store gains `userId`, `isPlatformAdmin`)
- Modify: `lib/tenant-access.ts` (`resolveTenantAccess` returns these; sets storage)
- Verify all 7 current `runWithTenant` call sites compile (routes under `app/api/admin/organizations/[orgId]/*`, `app/api/roles/route.ts`, `lib/authz.ts`)

**Step 1:** Failing test in `tests/isolation/application/tenant-context.test.ts`: store round-trips all three fields; getters return null when unset (fail-closed). Run — FAIL.

**Step 2:** Implement: `runWithTenant({ userId, orgId, isPlatformAdmin }, fn)`; `getCurrentOrgId()` unchanged in signature behavior. Update `resolveTenantAccess` to produce the object from `session.user.id`, target orgId, and existing `verifySuperAdmin` result (memoized). Update all call sites (7 files) — mechanical.

**Step 3:** Run `npm run test && npm run test:isolation:app`. Commit `feat(rls): verified (userId, orgId, isPlatformAdmin) context store`.

### Task 1E: ~~Flip app connection to nipp_app role~~ **MOVED TO PHASE 2 (atomic cutover)**

Safety decision made during Phase 1 execution: flipping `DATABASE_URL` to the non-owner
role while RLS enforcement is not yet fully context-wired at ALL call sites would cause any
not-yet-wrapped query to run with empty GUCs and silently return zero rows. The connection
flip must therefore ship **atomically** with Phase 2 (policies live + full GUC coverage
+ `DATABASE_URL`→nipp_app together). This task is intentionally NOT executed in Phase 1.

Phase 1 leaves the role created + granted but idling; app keeps running as owner until Phase 2.

---

## Phase 2 — Policy catalog

### Task 2A: Full 18-table policy migration (supersedes stale drafts)

**Objective:** Every org-scoped/tenant-visible table live-enforced; platform admin via boolean flag.

**Files:**
- Create: `prisma/migrations/<ts>_rls_complete_policies/migration.sql`
- Modify: delete superseded unapplied drafts? **Do NOT delete existing migration files** (git history); the new migration is authoritative and later in time; add comment header stating it supersedes `20260711000000_rls_policies` + `20260715000000_permission_rls_fix`, and note those remain no-ops-safe: they CREATE statements that will now conflict. **Fix:** since the old never-applied migrations WOULD apply first in a fresh migrate (time-order!) and create duplicate/conflicting policies — handle by giving new migration a name earlier in sort? No: cleanest is to edit the two stale unapplied migration files in place, replacing their content with a no-op comment ("superseded by <ts>_rls_complete_policies"), because they were never applied to ANY instance (verified). Document this edit in PR.

**Step 1:** Write migration following catalog in `documents/rls-complete-implementation.md` §3.3 exactly:
- `ALTER TABLE … ENABLE ROW LEVEL SECURITY;` for each of the 18 tables (Team, TeamMember, TeamRole, Calendar, CalendarEvent, Role, RolePermission, MemberRole, Member, Organization, Invitation, SentInvitation, AuditLog, NotificationLog, Notification, JobDefinition, JobExecution, Permission)
- Default per-table policy: `USING ("organizationId"::text = current_setting('app.current_org_id', true) OR current_setting('app.is_platform_admin', true)::int = 1) WITH CHECK ("organizationId"::text = current_setting('app.current_org_id', true))` — with table-specific column names (`Member`, `Invitation`, `SentInvitation` use `orgId`).
- `Organization`: SELECT `id = ctx OR platform`; INSERT platform-only; UPDATE/DELETE platform-only + WITH CHECK true (platform actor context always = target org).
- `AuditLog`: SELECT `organizationId IS NULL OR organizationId = ctx OR platform`; INSERT same; no UPDATE/DELETE policy.
- `Notification`: SELECT `(organizationId IS NULL OR organizationId = ctx) OR is_platform_admin`; INSERT org OR platform (with CHECK); UPDATE platform-or-org.
- `JobDefinition`/`JobExecution`: single policy `FOR ALL USING (current_setting('app.is_platform_admin', true)::int = 1 AND "platformOrgId"::text = current_setting('app.platform_org_id', true))` — note: this means the route also sets `app.platform_org_id` GUC; add it to Task 1B's builder and verify platform org id source is env (existing `getPlatformOrgId`).
- `Permission`: SELECT `platform OR EXISTS (SELECT 1 FROM "RolePermission" rp WHERE rp."permissionId"="Permission".id AND rp."organizationId"::text = current_setting('app.current_org_id', true))`.
- Fail-closed note in header: unset GUC → '' matches nothing, flag '0' — every policy denies empty-context.

**Step 2:** Apply to seeded dev DB (`npx prisma migrate dev`), confirm `\d+ Role` shows RLS enabled.
**Step 3:** Manual probe: connect as `nipp_app`, set GUCs for org A, `SELECT count(*) FROM "CalendarEvent"` — expect only org A rows; without GUCs — expect 0.
**Step 4:** Commit `feat(db): complete RLS policy catalog (18 tables)`.

### Task 2B: Supersede stale draft migration content

**Objective:** Fresh `migrate deploy`/`db push` from scratch produces exactly the intended state.

**Files:** Edit `prisma/migrations/20260711000000_rls_policies/migration.sql` and `20260715000000_permission_rls_fix/migration.sql` bodies → replace with comment `-- superseded by <ts>_rls_complete_policies (never applied to any instance; kept for history)`.

**Steps:** 1) Edit both. 2) On a THROWAWAY DB: drop, recreate, `prisma migrate deploy`, then diff `pg_policies` against the new migration's catalog — expect exact match. 3) Commit `chore(db): mark superseded RLS migrations no-op`.

---

## Phase 3 — Kill the unscoped bypass

### Task 3A: Migrate all `globalDb` importers to verified-context tenantDb

**Objective:** No code path exists that reads/writes across tenants without a target-org context.

**Files:** ~35 files listing `import globalDb from '@/lib/global-db'` + 9 `superAdminStorage.run(true, …)` wrappers (calendar routes, admin org/teams/roles/permissions/users routes, services/*).

This is the largest task — split per-area into sub-tasks of ~4–6 files each:
- **3A.1:** lib-level: `lib/recurrence-scopes.ts`, `lib/job-scheduler-engine.ts`, `lib/calendar-event-scheduler.ts`, `lib/background-health-check.ts`, `lib/audit-log.ts`, `lib/notification-push.ts`, `lib/notifications/dispatcher.ts`, `lib/job-scheduler-bree.ts`, `lib/job-scheduler-builtins.ts`
- **3A.2:** services/*: user-service, organization-service, team-service, calendar-event-service, calendar-service, calendar-notification-service, permission-service, resource-service, job-scheduler-service
- **3A.3:** app/api/admin + app/api/dashboard/admin routes
- **3A.4:** app/api/organizations/[orgId]/* tenant-facing routes (calendar-events, calendar, teams, org-chart, notifications)

Per sub-task pattern:
1. Replace `globalDb.x` → `tenantDb.x`; ensure every call runs inside existing `runWithTenant(...)` context (route already has orgId from param + verified access — set it). Remove `superAdminStorage.run(true, …)` wrappers (now meaningless). For platform-admin cross-tenant ops: `runWithTenant({userId, orgId: <target>, isPlatformAdmin:true}, …)` so RLS flag permits read and writes stay ctx-bound.
2. **Job-scheduler services:** these are inherently platform-scoped; they run in scheduler processes without a request — set context explicitly from verified env-derived platform org + operator user (`approvedBy`/`createdBy`), flag=1, `app.platform_org_id` = env id. Wrap the *whole engine tick* once per run (not per query) as a documented exception with its own comment block citing plan §3.4.
3. After each sub-task: `npx tsc --noEmit`, `npm run test && npm run test:isolation:app`. Commit per sub-task: `refactor(rls-<area>): globalDb → verified-context tenantDb`.

### Task 3B: Delete the bypass artifacts

**Objective:** Make misuse structurally impossible.

**Files:**
- Delete: `lib/global-db.ts`, `lib/global-db-guard.ts`
- Update tests referencing them (`tests/isolation/application/global-db-guard.test.ts` → convert to a test asserting these modules no longer exist / their exports are gone, or delete alongside its now-meaningless scope)

**Steps:** 1) `rg "global-db" lib app services tests scripts` — zero hits expected after 3A. 2) Delete files + guard test. 3) Full test pass. Commit `refactor(rls): remove unscoped globalDb client and TS-only guard`.

---

## Phase 4 — Harden & verify

### Task 4A: Database-layer RLS test suite (new, missing)

**Objective:** RLS verified independently of any app code; blocks merge on failure.

**Files:**
- Create: `tests/isolation/database/rls-org-scoped.spec.ts`, `rls-platform-admin.spec.ts`, `rls-audit-append-only.spec.ts`, `rls-job-definition-platform-only.spec.ts`, `rls-context-probe.spec.ts`, `migrations-ownership.spec.ts` (+ shared fixture helper that seeds 2 tenants via owner role)
- Modify: `vitest.config.ts` (include pattern), `package.json` (`test:isolation:db`: `vitest run tests/isolation/database`), `.github/workflows/ci.yml` (job after unit tests against the Postgres container already used by E2E, env: owner URL + NIPP_APP_DB_PASSWORD)

**Steps:**
1. Fixture helper: connect as owner; create org A/B users/members/platform membership + one Team/CalendarEvent per org; run once in `beforeAll` on a scratch schema (`public_rls_test`) to avoid dev-DB pollution.
2. Implement the 6 specs per catalog table in design doc §5.1 — each uses raw SQL as `nipp_app`, sets GUCs explicitly via `$unprepared('SELECT set_config(...)', [..])` (note: in pg-node use parameterized `set_config($1,$2,true)` to avoid injection), asserts row visibility per policy shape.
3. Ownership spec: assert `pg_class.reloowner` ≠ nipp_app for all public tables and RLS-enabled count = 18; golden-file hash of `pg_policies(qual)` compared to committed `tests/isolation/database/policy-catalog.golden` (generate in same task).
4. Wire CI job; run locally end-to-end: `npm run test:isolation:db`. Expect PASS.
5. Commit `test(rls): database-layer RLS isolation suite + ownership drift check, wired into CI`.

### Task 4B: App-layer hardening (type-safe model list, count/aggregate coverage, lint rules)

**Objective:** Close the silent-drift gaps in the Prisma extension and prevent future direct-Prisma misuse.

**Files:**
- Modify: `lib/tenant-db.ts` (typed array + add `count`, `aggregate`, `groupBy` handlers reusing scopeWhere/create)
- Create: `scripts/lint-guardrails.mjs` + ESLint config entries: deny `import` of `@/lib/rls-context` outside `lib/tenant-db.ts`; deny `new PrismaClient(` outside `lib/db.ts`

**Steps:**
1. Failing test: extension model coverage vs schema list — generate the expected set from `prisma client --json` output (script) and assert equality; add `count` scoping unit test. Run → FAIL.
2. Implement typing + handlers + lint rules. 3) `npm run lint && npm run test`. Commit `fix(tenant-db): typed model list, count/aggregate scoping, import guardrails`.

### Task 4C: Rewrite security docs (false claims)

**Objective:** `SECURITY.md` Appendix B and "Two-Layer Strategy" reflect post-refactoring reality.

**Files:** Modify `SECURITY.md` (lines ~70-128 for strategy + model table, ~560-590 appendix), `ISOLATION_TEST_STRATEGY.md`, `tests/isolation/README.md:27-29` (DB-layer section no longer "deferred"), schema header comment in `prisma/schema.prisma:14-18` (exempt-model list now accurate incl. Resource, ResourceRole, JobDefinition notes).

**Steps:** Regenerate the model inventory table from design doc §2.3/§3.3 with A/R/L columns all real; fix `tenantId` → `organizationId`; note JobDefinition/JobExecution platform-only stance and Resource exemption rationale (design §4.3). Update "last updated" stamp. Commit `docs: accurate RLS/security documentation post-refactor`.

### Task 4D: Full regression + perf gate

**Objective:** Prove the whole stack works with both layers active; guard policy overhead ≤2% p95.

**Steps:**
1. Fresh-container run: build docker test env (`docker compose -f docker-compose.test.yml up`), `npm run test:isolation` (app+e2e), `npm run test:isolation:db`, plus full e2e calendar/team specs (verify super-admin access to tenant B still works now via flag — previously it worked only by virtue of the unscoped client; this is the key behavioral proof).
2. Benchmark: 1M-row CalendarEvent fixture, measure `getEventsWithRecurrences` p95 before/after via existing `scripts/cache-benchmark.ts` harness pattern; record numbers in PR body; fail >2% regression.
3. Final commit (docs/PR notes): `chore(rls): verification results for complete RLS rollout`.

---

## Risks & open questions

1. **Per-operation interactive transaction overhead** (Task 1C decision) — mitigate with measured fallback (§fallback in task).
2. **Editing never-applied migration files** (Task 2B) relies on the verified fact they were never deployed anywhere — confirm against prod DB if a prod exists: `SELECT count(*) FROM _prisma_migrations WHERE migration_name LIKE '%rls%'` before editing; if live, write a fix-up migration instead.
3. **Platform admin writing to tenant data** now ctx-bounded (writes target = current org) — matches product model per `resolveTenantAccess`, but confirm no admin UI flow issues a request with orgId ≠ intended write target (e2e Task 4D step 1 covers).
4. Job-scheduler's out-of-request context is the one sanctioned exception — keep it in its own function with a doc comment, never generalize.

**Verification commands for the whole plan (final state):** `npm run lint && npm run test && npm run test:isolation && npm run test:isolation:db && npm run build`, all green, on CI and locally.

---

## Phase 1 execution log (2026-09-19) — AS-BUILT

Status: **DONE, verified.** All unit tests pass (1889/1889), `tsc --noEmit` exit 0, ESLint clean, isolation app-suite green (79/79). No commits made (per repo convention — user to commit/PR).

| Task | As-built detail |
|---|---|
| **1A** nipp_app role | `prisma/migrations/20260919035439_rls_roles/migration.sql` + applier `scripts/apply-roles-migration.ts`. Password from `NIPP_APP_DB_PASSWORD` (added to `.env`, gitignored; placeholder documented in `.env.example`). **Applied live** to dev `nipp_dev`: role created, 92 privilege rows across 23 tables granted (SELECT/INSERT/UPDATE/DELETE), and a connectivity check as `nipp_app` succeeded (`current_user = nipp_app`). Role is NOT yet the app's connection user — that flips in Phase 2. |
| **1B** GUC builder | `lib/rls-context.ts::buildRLSContextQueries(ctx)` → single statement setting `app.current_user_id` / `app.current_org_id` / `app.is_platform_admin` with `local=true`. Quote-escaping included. **Dead code `lib/rls.ts` deleted** (zero callers). Test: `tests/unit/rls-context.test.ts` (3 cases, green). |
| **1C** txn wrapper | Built the correct primitive `lib/rls-transaction.ts::runWithRLS(client, ctx, op)`: validates ctx fail-closed, then one interactive Prisma `$transaction` that sets GUCs via `$executeRawUnsafe` on the SAME pinned connection and runs the op on it. **Critically verified empirically** against dev Postgres 16: inside txn GUCs visible (`probe-user\|probe-org\|1`), after txn they reset to unset — proving pooling cannot leak context and that local-scope binding is correct. Test: `tests/unit/rls-transaction.test.ts` (3 cases, green). **Deliberate deferral:** wiring `runWithRLS` into live service call paths is NOT done in Phase 1 (no policies live yet; it ships atomically with Phase 2/3) — see Task 1E note. |
| **1D** verified context | `lib/tenant-context.ts`: new `TenantContextObject` + `runWithTenantContext(ctx,fn)` (fail-closed on missing userId/orgId) + getters `getCurrentUserId`, `getIsPlatformAdminFlag`, `getRLSContext`. Legacy `runWithTenant(orgId,fn)` preserved for backward compat. `lib/tenant-access.ts::toTenantContext(access, sessionUserId)` builds the ctx from an already-resolved access decision (no extra lookups; PLATFORM_ADMIN→flag). Tests: `tests/unit/tenant-context-rls.test.ts` + `tests/unit/tenant-access-rls.test.ts` (green). |
| **1E** conn flip | **MOVED to Phase 2 atomic cutover** — flipping identity before full GUC coverage would silently zero rows for any not-yet-wrapped query. Role is idle-granted until then. |

Key empirical facts recorded for later phases:
- Dev DB has **no `_prisma_migrations`** (created via `db push`) → Phase 2 must reconcile the migration chain first.
- Postgres **16.15**, direct TCP SCRAM; owner DSN needs a password (DIRECT_* local-trust variant fails over TCP) — applier prefers a credentialed DSN.
- `runWithRLS` connection-pinning confirmed on this exact engine version — Phase 2 can rely on the interactive-transaction pattern for binding GUCs.

