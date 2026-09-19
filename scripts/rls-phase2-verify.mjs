/**
 * Phase 2 Task 2A/2B verification driver.
 *
 * Applies the COMPLETE migration chain (in name order, exactly like
 * `prisma migrate deploy` on a fresh instance) to a FRESH throwaway database,
 * seeds a minimal two-tenant + platform fixture as owner, then probes RLS
 * behavior as nipp_app (non-owner role): tenant ctx, platform-admin ctx,
 * write-binding, append-only denial, and the fail-closed empty context.
 *
 * Usage:  node scripts/rls-phase2-verify.mjs    (DB rls_phase2_verify is dropped + recreated)
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const ownerBase = new URL(process.env.DATABASE_URL); // postgres user (owner)
if (!ownerBase.password || !process.env.NIPP_APP_DB_PASSWORD) {
  console.error('FATAL: export DATABASE_URL and NIPP_APP_DB_PASSWORD first');
  process.exit(1);
}
const appPw = process.env.NIPP_APP_DB_PASSWORD;
const DB = 'rls_phase2_verify';
// Swap the path and drop Prisma-only pool params (?connection_limit=…&pool_timeout=…)
// that psql rejects as invalid URI query parameters. pg accepts them fine, so the
// appUrl below (used with pg.Client) keeps whatever is left — none are stripped there.
const withPath = (db) => { const u = new URL(process.env.DATABASE_URL); u.pathname = '/' + db; u.search = ''; return u.toString(); };
const ownerUrl = withPath('postgres');
const dbOwnerUrl = withPath(DB);
const appUrl = withPath(DB).replace(/\/\/[a-z]+:[^@]+@/, '//nipp_app:' + appPw + '@');

const orgA = 'org_alpha_1';
const orgB = 'org_beta_2';
const pltf = 'org_platform_9';
const superU = 'user_suppr';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}

const owner = new pg.Client({ connectionString: ownerUrl });
await owner.connect();

// 1. Fresh throwaway DB -------------------------------------------------------
console.log(`== setup: drop+create ${DB}`);
await owner.query(`DROP DATABASE IF EXISTS ${DB}`);
await owner.query(`CREATE DATABASE ${DB}`);

// 2. Apply full migration chain in name order ----------------------------------
const fs = await import('node:fs');
const files = execSync('ls prisma/migrations').toString().trim().split('\n').sort()
  .filter((f) => fs.statSync(`prisma/migrations/${f}`).isDirectory()); // skip migration_lock.toml
console.log(`== migrate deploy: ${files.length} migration files in order ==`);
const tx = new pg.Client({ connectionString: dbOwnerUrl });
await tx.connect();
for (const f of files) {
  // psql handles $-quoted PL/pgSQL bodies; pg.Client does not.
  execSync(
    `psql "${dbOwnerUrl}" -v ON_ERROR_STOP=1 -f "prisma/migrations/${f}/migration.sql"`,
    { stdio: 'pipe', env: { ...process.env, PGPASSWORD: ownerBase.password } },
  );
  console.log(`   applied ${f}`);
}

// nipp_app role comes from the chain; set its password here (env-sourced).
await tx.query(`ALTER ROLE nipp_app WITH PASSWORD '${appPw.replace(/'/g, "''")}'`);

// 3. Fixture: two tenants + platform org ---------------------------------------
console.log('== fixture ==');
// NOTE: Prisma migrations create camelCase columns with DOUBLE QUOTES, so the
// catalog names are literal ("orgId", "organizationId", …). Bare SQL must quote
// every one of them — unquoted identifiers fold to lowercase and don't exist.
await tx.query(`
INSERT INTO "User" (id, name, email, "updatedAt") VALUES
  ('user_aaaa', 'Alice A', 'a@t.co', now()),
  ('user_bbbb', 'Bob B',   'b@t.co', now()),
  ('${superU}',  'Super P', 'sup@s.co', now());
INSERT INTO "Organization" (id, name, slug, "updatedAt") VALUES
  ('${orgA}', 'Tenant A', 'ta', now()),
  ('${orgB}', 'Tenant B', 'tb', now()),
  ('${pltf}', 'Platform', 'platform', now());
INSERT INTO "Member" (id, role, "orgId", "userId", "updatedAt") VALUES
  ('mem-a1', 'admin',  '${orgA}', 'user_aaaa', now()),
  ('mem-b1', 'member', '${orgB}', 'user_bbbb', now()),
  ('mem-p1', 'member', '${pltf}', '${superU}', now());
INSERT INTO "Team" (id, name, "organizationId", "updatedAt") VALUES
  ('team-a1', 'Ops A', '${orgA}', now()),
  ('team-b1', 'Ops B', '${orgB}', now());
INSERT INTO "Calendar" (id, name, "organizationId", "updatedAt") VALUES
  ('cal-a1', 'Main A', '${orgA}', now()),
  ('cal-b1', 'Main B', '${orgB}', now());
INSERT INTO "CalendarEvent" (id, title, "startDate", "endDate", "calendarId", "organizationId", "updatedAt") VALUES
  ('ev-a1', 'Event A', now(), now() + interval '1h', 'cal-a1', '${orgA}', now()),
  ('ev-b1', 'Event B', now(), now() + interval '1h', 'cal-b1', '${orgB}', now());
INSERT INTO "JobDefinition" (id, "platformOrgId", name, "handlerKey", "scheduleExpr", "updatedAt") VALUES
  ('job-p1', '${pltf}', 'nightly', 'builtin:x', '{"kind":"cron"}', now());
INSERT INTO "Notification" (id, title, message, "organizationId", "updatedAt") VALUES
  ('ntf-a1', 'A msg',  'm', '${orgA}', now()),
  ('ntf-g1', 'GLOBAL', 'm', NULL, now());
INSERT INTO "AuditLog" (id, timestamp, action, "resourceType", "organizationId") VALUES
  ('aud-a1', now(), 'team.created', 'Team',   '${orgA}'),
  ('aud-n1', now(), 'global.note',  'System', NULL);
`);

// Sanity: RLS enabled exactly where the catalog says (18 tables).
const rlsCount = (await tx.query(`SELECT count(*)::int AS n FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity`)).rows[0].n;
check('RLS enabled on exactly 18 tables', rlsCount, 18);

// 4. Probes as nipp_app --------------------------------------------------------
const app = new pg.Client({ connectionString: appUrl });
await app.connect();
check('connects as nipp_app', (await app.query(`SELECT current_user AS u`)).rows[0].u, 'nipp_app');
check('no BYPASSRLS', (await app.query(`SELECT rolbypassrls FROM pg_roles WHERE rolname='nipp_app'`)).rows[0].rolbypassrls, false);

// set_config(..., true) is TRANSACTION-local: to probe policies the GUC setup
// and the guarded query must happen in ONE explicit transaction on this
// connection — exactly what lib/rls-transaction.ts::runWithRLS does for the app.
const gucSql = ({ userId = superU, orgId, isPltf, pltfId } = {}) => {
  const parts = [`set_config('app.current_user_id', '${userId}', true)`];
  if (orgId !== undefined) parts.push(`set_config('app.current_org_id', '${orgId}', true)`);
  if (isPltf !== undefined) parts.push(`set_config('app.is_platform_admin', '${isPltf ? '1' : '0'}', true)`);
  if (pltfId !== undefined) parts.push(`set_config('app.platform_org_id', '${pltfId}', true)`);
  return `SELECT ${parts.join(',')}`;
};
// Run a batch of probes inside one txn that first sets the given GUCs.
const probeBlock = async (gucs, tableCounts) => {
  await app.query(`BEGIN`);
  try {
    if (gucs) await app.query(gucSql(gucs));
    const out = {};
    for (const [table] of Object.entries(tableCounts)) {
      out[table] = (await app.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n;
    }
    await app.query(`COMMIT`);
    return out;
  } catch (e) {
    await app.query(`ROLLBACK`).catch(() => {});
    throw e;
  }
};
// Probe a write statement under RLS. Denied writes do NOT throw (except
// INSERT whose WITH CHECK fails hard): UPDATE/DELETE just match 0 rows.
const probeWrite = async (gucs, sql) => {
  await app.query(`BEGIN`);
  let err = null;
  let rowCount = -1;
  try {
    if (gucs) await app.query(gucSql(gucs));
    const res = await app.query(sql);
    rowCount = res.rowCount ?? -1;
  } catch (e) {
    err = e.message;
  }
  await app.query(`ROLLBACK`);
  return { err, rowCount };
};

console.log('\n== probes: tenant context org A ==');
let r = await probeBlock({ userId: 'user_aaaa', orgId: orgA, isPltf: false }, {
  CalendarEvent: 1, Team: 1, Member: 1, Notification: 2, AuditLog: 2, Organization: 1, JobDefinition: 0,
});
check('tenant ctx sees only org A rows (Team/Member/CalendarEvent/Organization)',
  [r.Team, r.Member, r.CalendarEvent, r.Organization].join(','), '1,1,1,1');
check('Notification: own-org + global broadcasts', r.Notification, 2);
check('AuditLog: own-org + NULL-org rows', r.AuditLog, 2);
check('JobDefinition invisible to tenant ctx', r.JobDefinition, 0);

console.log('\n== probes: platform admin context ==');
r = await probeBlock({ orgId: orgB, isPltf: true, pltfId: pltf }, {
  CalendarEvent: 2, Member: 3, Organization: 3, JobDefinition: 1,
});
check('admin sees both orgs CalendarEvents', r.CalendarEvent, 2);
check('admin sees all members', r.Member, 3);
check('admin sees all Organizations', r.Organization, 3);
check('admin+platformOrgId GUC sees JobDefinition', r.JobDefinition, 1);

r = await probeBlock({ orgId: orgB, isPltf: true }, { JobDefinition: 0 }); // flag=1 but no platform_org_id
check('flag=1 without app.platform_org_id → jobs still hidden', r.JobDefinition, 0);

console.log('\n== probes: writes are ctx-bound even for admin ==');
let w = await probeWrite({ orgId: orgB, isPltf: true },
  `INSERT INTO "Team" (id, name, "organizationId", "updatedAt") VALUES ('team-x1', 'Rogue', '${orgA}', now())`);
check('admin INSERT into non-ctx org denied by WITH CHECK', w.err !== null, true);
w = await probeWrite({ orgId: orgB, isPltf: true }, `UPDATE "Organization" SET name='Hacked' WHERE id='${orgA}'`);
check('admin UPDATE of org row where ctx=other touches 0 rows', w.rowCount, 0);
w = await probeWrite({ orgId: orgA, isPltf: false }, `DELETE FROM "AuditLog"`);
check('DELETE AuditLog deletes 0 rows (append-only)', w.rowCount, 0);

console.log('\n== probes: fail-closed empty context ==');
// Fresh client — guarantees no GUC residue from any prior session/txn.
const appFresh = new pg.Client({ connectionString: appUrl });
await appFresh.connect();
await appFresh.query(`BEGIN`);
const freshCounts = {};
for (const table of ['CalendarEvent', 'Member', 'Organization', 'AuditLog']) {
  freshCounts[table] = (await appFresh.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n;
}
await appFresh.query(`COMMIT`);
await appFresh.end();
// AuditLog intentionally keeps NULL-org (global) rows visible even with an
// empty context — that is what gives platform admin cross-tenant audit
// visibility (design §3.3). The other three org-scoped tables must return 0.
check('no GUCs → no tenant rows; only global AuditLog visible', Object.values(freshCounts).join(','), '0,0,0,1');

console.log('\n== catalog dump (policy set) ==');
const pol = await tx.query(`SELECT tablename, policyname, cmd FROM pg_policies
  WHERE schemaname='public' ORDER BY tablename, policyname`);
for (const r of pol.rows) console.log(`   ${r.tablename} / ${r.policyname} [${r.cmd}]`);

await app.end();
await tx.end(); // release the DB connection BEFORE dropping the database
console.log(`\n== teardown: drop ${DB}`);
await owner.query(`DROP DATABASE IF EXISTS ${DB}`);
await owner.end();
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;


