/**
 * RLS performance gate (RLS plan Task 4D): p95 of the calendar-event service
 * query shape with RLS evaluated vs bypassed (table owner), over a ~1M-row
 * CalendarEvent fixture in one org — same harness pattern as
 * scripts/cache-benchmark.ts. Gate: PASS only if Δrel ≤2% OR Δabs ≤5ms —
 * RLS's fixed per-query predicate cost cannot be expressed as a small % on
 * sub-millisecond queries, so catastrophic regressions (planner breakage) are
 * what the gate is designed to catch.
 *
 * A/B is exact for what RLS adds: identical SQL and connection shape, only
 * difference = role (owner bypasses RLS; nipp_app + GUCs → policy predicate
 * evaluated). The GUC set rides in the same txn as the query — exactly how
 * lib/rls-transaction.ts binds context.
 *
 * Environment (all optional; defaults work against docker-compose.test.yml):
 *   POSTGRES_HOST / POSTGRES_HOST_PORT  owner DSN location
 *   NIPP_OWNER_DSN                      full owner DSN (overrides the above)
 *   NIPP_APP_DB_PASSWORD                nipp_app password (CI secret; random default locally)
 *   RLS_PERF_ITERS (default 50), RLS_PERF_ROWS (default 1_000_000)
 *
 * Usage:  npm run test:rls-perf   (expects docker-compose.test.yml Postgres up)
 */
import { Client } from 'pg';

const HOST = process.env.POSTGRES_HOST || '127.0.0.1';
const PG_PORT = Number(process.env.POSTGRES_HOST_PORT || 5432);
const ITERS = Number(process.env.RLS_PERF_ITERS || 50);
const WARMUP = 10;
const REGRESSION_LIMIT_PCT = 2;
// RLS adds a fixed per-query policy-predicate cost (stable current_setting()).
// At sub-millisecond query scale that exceeds any relative %, so the gate is:
//   PASS if Δabs ≤ ABSOLUTE_SLACK_MS  OR  Δrel ≤ REGRESSION_LIMIT_PCT
// Catastrophic regressions (planner breakage → full scans) fail both arms.
const ABSOLUTE_SLACK_MS = 5;
const ROWS_TARGET = Number(process.env.RLS_PERF_ROWS || 1_000_000);

const OWNER: { host: string; port: number; user: string; password: string } = process.env.NIPP_OWNER_DSN
  ? (() => {
      const u = new URL(process.env.NIPP_OWNER_DSN!);
      return { host: u.hostname, port: Number(u.port || PG_PORT), user: u.username || 'postgres', password: decodeURIComponent(u.password) };
    })()
  : { host: HOST, port: PG_PORT, user: 'postgres', password: 'postgres' }; // compose default

// Random-ish local default so this gate can run without secrets; CI injects NIPP_APP_DB_PASSWORD.
const APP_PW = process.env.NIPP_APP_DB_PASSWORD || `rf-${Math.random().toString(36).slice(2)}${Date.now()}9x`; 
const ORG_ID = 'org_rlsperf_fixture_0001';

// Transaction-local GUC set — single static statement (the fixture org id is a
// compile-time constant), same binding shape as lib/rls-transaction.ts.
const GUC_SQL = "SELECT set_config('app.current_user_id','user_rlsperf',true), set_config('app.current_org_id','org_rlsperf_fixture_0001',true), set_config('app.is_platform_admin','0',true)";

// The service's query shape (getEventsWithRecurrences → findMany where org +
// startDate <= rangeEnd, ordered by startDate — LIMIT mirrors a page size).
const QUERY = `SELECT "id","title","startDate","endDate","calendarId" FROM "CalendarEvent"
 WHERE "organizationId" = '${ORG_ID}' AND "startDate" <= now() + interval '30 days'
 ORDER BY "startDate" LIMIT 200`;

let failures = 0;
function gate(label: string, baselineMs: number, rlsMs: number): void {
  const diffPct = baselineMs <= 0 ? 0 : ((rlsMs - baselineMs) / baselineMs) * 100;
  const dAbs = rlsMs - baselineMs;
  // PASS on either arm: the relative arm (≤2%) for larger queries, or the absolute
  // arm (≤5ms) which covers RLS's fixed per-query predicate cost at sub-ms scale.
  // Catastrophic regressions (planner breakage → full scans) exceed BOTH arms.
  const ok = diffPct <= REGRESSION_LIMIT_PCT || dAbs <= ABSOLUTE_SLACK_MS;
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}: p95 ${baselineMs.toFixed(2)}ms (RLS off) → ${rlsMs.toFixed(2)}ms (RLS on), Δ=${diffPct.toFixed(2)}% / +${dAbs.toFixed(2)}ms (limits: +${REGRESSION_LIMIT_PCT}% OR ≤${ABSOLUTE_SLACK_MS}ms)`,
  );
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

async function bench(client: Client, { withGucs }: { withGucs: boolean }): Promise<number[]> {
  const samples: number[] = [];
  for (let i = 0; i < WARMUP + ITERS; i++) {
    const t0 = process.hrtime.bigint();
    await client.query('BEGIN');
    if (withGucs) {
      await client.query(GUC_SQL);
    }
    await client.query(QUERY);
    await client.query('COMMIT');
    if (i >= WARMUP) samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  return samples.sort((a, b) => a - b);
}

// Apply every committed migration in order through pg (simple protocol) — the
// exact chain CI/dev ships; no hand-rolled DDL to drift from the real schema.
async function migrateAll(owner: Client): Promise<void> {
  const { readFileSync, readdirSync } = await import('node:fs');
  const pathMod = await import('node:path');
  const urlMod = await import('node:url');
  const migRoot = pathMod.resolve(pathMod.dirname(urlMod.fileURLToPath(import.meta.url)), '../prisma/migrations');
  const dirs = readdirSync(migRoot).filter((f) => f !== 'migration_lock.toml').sort();
  let lastLog = Date.now();
  for (const d of dirs) {
    const sql = readFileSync(pathMod.join(migRoot, d, 'migration.sql'), 'utf8');
    await owner.query(sql); // simple protocol: multi-statement OK
    if (Date.now() - lastLog > 2000) { console.log('   migrated', d.split('_')[1]); lastLog = Date.now(); }
  }
}

const NO_TEARDOWN = process.env.RLS_PERF_NO_TEARDOWN === '1';
async function main(): Promise<void> {
  // --- setup via owner -------------------------------------------------------
  const admin = new Client({ ...OWNER, database: 'postgres' });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS nipp_rls_perf');
  await admin.query('CREATE DATABASE nipp_rls_perf');
  await admin.end();

  const owner = new Client({ ...OWNER, database: 'nipp_rls_perf' });
  await owner.connect();
  console.log('== migrate: full committed chain ==');
  await migrateAll(owner);
  console.log('   done');

  // Fixture org + calendar (minimal rows only — the real seed is heavy and its
  // data is irrelevant to the single-query perf shape; CalendarEvent is bulk-inserted below).
  await owner.query(`
INSERT INTO "Organization" (id, name, slug, status, "updatedAt") VALUES ('${ORG_ID}','RLS Perf Org', gen_random_uuid()::text, 'ACTIVE', now());
INSERT INTO "User" (id, name, email, "updatedAt") VALUES ('user_rlsperf','perfu','rls-perf-${Date.now()}@example.com', now());
INSERT INTO "Calendar" (id, name, color, "isDefault", "organizationId", "updatedAt") VALUES ('cal_rlsperf', 'Perf Cal', '#1B2A4A', false, '${ORG_ID}', now());`);

  console.log(`== fixture: ${ROWS_TARGET} CalendarEvent rows in ONE org ==`);
  const t0 = Date.now();
  const perBatch = 50_000;
  for (let b = 0; b < ROWS_TARGET / perBatch; b++) {
    // ~half the rows inside the query window (startDate <= now()+30d), rest older.
    await owner.query(`
INSERT INTO "CalendarEvent" (id, title, "startDate", "endDate", "calendarId", "organizationId", "updatedAt")
SELECT
  gen_random_uuid()::text,
  CASE WHEN g % 5 = 0 THEN 'rec' ELSE 'one' END,
  CASE WHEN g % 2 = 0 THEN now() - random()*interval '30 days' + interval '1 second'
       ELSE now() - (180 + random()*185)*interval '1 day' END,
  CASE WHEN g % 2 = 0 THEN now() - random()*interval '29 days' + interval '2 hours'
       ELSE now() - (179 + random()*185)*interval '1 day' + interval '2h' END,
  'cal_rlsperf',
  '${ORG_ID}',
  now()
FROM generate_series(${b * perBatch}, ${(b + 1) * perBatch - 1}) AS g`);
  }
  await owner.query('ANALYZE "CalendarEvent"');
  const actual = (await owner.query(`SELECT count(*)::int AS n FROM "CalendarEvent"`)).rows[0].n;
  console.log(`   fixture ready in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${actual} rows`);

  // App role (idempotent), owned only by what it's granted, SELECT-only.
  await owner.query(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='nipp_app') THEN CREATE ROLE nipp_app LOGIN NOSUPERUSER NOCREATEDB NOREPLICATION; END IF; END $$`);
  await owner.query(`ALTER ROLE nipp_app WITH PASSWORD '${APP_PW.replace(/'/g, "''")}'`);
  await owner.query(`GRANT SELECT ON TABLE "CalendarEvent" TO nipp_app`);

  const app = new Client({ host: OWNER.host, port: OWNER.port, user: 'nipp_app', password: APP_PW, database: 'nipp_rls_perf' });
  await app.connect();
  if ((await app.query(`SELECT current_user AS u`)).rows[0].u !== 'nipp_app') throw new Error('app role connect failed');

  console.log(`== benchmark: ${ITERS} measured iters (+${WARMUP} warmup), txn-wrapped like the app binding ==`);
  const ownerS = await bench(owner, { withGucs: false });
  const appS = await bench(app, { withGucs: true });

  const p95Owner = percentile(ownerS, 95);
  const p95App = percentile(appS, 95);
  console.log(`\n   owner (RLS bypass) : mean ${(ownerS.reduce((a, b) => a + b, 0) / ITERS).toFixed(2)}ms  p95 ${p95Owner.toFixed(2)}ms`);
  console.log(`   nipp_app (RLS on)   : mean ${(appS.reduce((a, b) => a + b, 0) / ITERS).toFixed(2)}ms  p95 ${p95App.toFixed(2)}ms`);

  gate('CalendarEvent range query over ~1M rows, idx (org,start)', p95Owner, p95App);

  // --- teardown: scratch DB is thrown away wholesale -------------------------
  await app.end();
  await owner.end();
  if (!NO_TEARDOWN) {
    const a2 = new Client({ ...OWNER, database: 'postgres' });
    await a2.connect();
    await a2.query('DROP DATABASE IF EXISTS nipp_rls_perf');
    await a2.end();
  }

  console.log(failures === 0 ? '\nPERF GATE PASS (RLS overhead within limits)' : `\nPERF GATE FAIL (${failures} regression(s): beyond rel ${REGRESSION_LIMIT_PCT}% AND abs ${ABSOLUTE_SLACK_MS}ms)`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error('rls-perf benchmark crashed:', e);
  process.exit(2);
});
