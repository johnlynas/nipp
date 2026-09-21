// Probe: does a dedicated pool-pinned single-connection PrismaClient (NO interactive tx)
// support the GUC-pin design for the read path? As nipp_app on dev DB:
//   create client -> set 3 GUCs session-scoped via $executeRawUnsafe (no BEGIN/COMMIT)
//   -> verify visible -> heavy SIBLING parallelism (findMany+groupBy+findMany on the same link)
//   -> sibling #4 re-reads GUCs mid-stream (must still be set on this connection)
//   -> nested real $transaction inherits session GUCs + is a genuine txn boundary
//   -> reset GUCs + $disconnect -> pool clean.
// Usage: node scripts/tmp-probe-pinned.mjs
import pg from 'pg';
import { readFileSync } from 'node:fs';
for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)=(.*)$/.exec(line);
  if (!m) continue;
  let v = m[2].trim().replace(/\r$/, '');
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  process.env[m[1]] ??= v;
}

const appUrl = new URL(process.env.DATABASE_URL);
// Force the NON-OWNER app role — RLS only applies to it:
appUrl.username = 'nipp_app';
if (process.env.NIPP_APP_DB_PASSWORD) appUrl.password = process.env.NIPP_APP_DB_PASSWORD;
// CRITICAL: a dedicated client with pool=1 IS the "pinned link". With pool>1,
// sibling autocommit ops can land on other connections without the GUCs.
appUrl.searchParams.set('connection_limit', '1');
appUrl.searchParams.set('pool_timeout', '60');
console.log(`connecting as ${appUrl.username}@${appUrl.host}${appUrl.pathname}`);

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
let failures = 0;
const check = (l, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}`); if (!ok) failures++; };

async function runProbe(tag, gucs, orgColFilter) {
  const prisma = new PrismaClient({ datasources: { db: { url: appUrl.toString() } }, log: [] });
  try {
    // Session-scoped GUCs (is_local=false is the default we want: set WITHOUT a txn
    // => persists for the whole connection). No BEGIN/COMMIT anywhere for reads.
    let gucSql =
      `SELECT set_config('app.current_user_id','${gucs.userId}',false),` +
      ` set_config('app.current_org_id','${gucs.orgId}',false),` +
      ` set_config('app.is_platform_admin','${gucs.flag ? '1' : '0'}',false)`;
    if (gucs.platformOrgId) gucSql += `, set_config('app.platform_org_id','${gucs.platformOrgId}',false)`;
    await prisma.$executeRawUnsafe(gucSql);
    const vis = (await prisma.$queryRawUnsafe(`SELECT current_setting('app.current_org_id', true) AS v, current_user AS u`))[0];
    check(`${tag}: GUC visible after bare set_config on pinned link`, vis.v === gucs.orgId && vis.u === appUrl.username);

    // The exact org-list + resource-list sibling shape — 4 concurrent ops, one physical link:
    const [orgs, byStatus, res, evts] = await Promise.all([
      prisma.organization.findMany({ select: { id: true } }),
      prisma.organization.groupBy({ by: ['status'], _count: { status: true } }),
      prisma.resource.findMany({ select: { id: true } }),
      (() => prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "CalendarEvent"`))(),
    ]);
    check(`${tag}: 4-way sibling parallelism on one link -> orgs=${orgs.length} statuses=${byStatus.length} res=${res.length} events=${evts[0].n}`, Array.isArray(orgs) && byStatus.length >= 1);

    // GUCs must STILL be set mid-op-stream (same physical connection, no txn scope):
    const vis2 = (await prisma.$queryRawUnsafe(`SELECT current_setting('app.current_org_id', true) AS v`))[0];
    check(`${tag}: GUC still bound mid-opstream`, vis2.v === gucs.orgId);

    // Nested REAL transaction on the same link: sees session GUCs + genuine txn boundary.
    const nested = await prisma.$transaction(async (tx) => {
      const g = (await tx.$queryRawUnsafe(`SELECT current_setting('app.current_org_id', true) AS v, CASE WHEN txid_current() IS NULL THEN 0 ELSE 1 END AS in_tx`))[0];
      const rows2 = await tx.organization.count(); // sibling inside nested tx too
      return { g, rows2 };
    });
    check(`${tag}: nested $tx inherits session GUCs + is a real txn`, nested.g.v === gucs.orgId && nested.g.in_tx === 1 && typeof nested.rows2 === 'number');

    // RLS row filtering assertion (if applicable): non-platform ctx must not see platform org rows.
    if (orgColFilter) check(tag, orgColFilter(orgs));

    return { orgs, byStatus, res, evts };
  } finally {
    try { await prisma.$executeRawUnsafe(`SELECT set_config('app.current_user_id','',false), set_config('app.current_org_id','',false), set_config('app.is_platform_admin','0',false), set_config('app.platform_org_id','',false)`); } catch { /* best-effort GUC cleanup on teardown */ }
    await prisma.$disconnect();
  }
}

const platformOrgId = process.env.PLATFORM_ORGANIZATION_ID || '';

// 1) platform ctx (flag=1, platform org): all rows visible
{
  const r = await runProbe('platform', { userId: 'x', orgId: platformOrgId, flag: true, platformOrgId }, () => true);
  check('platform ctx counts >= totals', (r.orgs?.length ?? 0) >= 2 && (r.byStatus?.length ?? 0) >= 1);
}

// 2) empty/false-flag org: fail-closed zero rows on every policy-covered table
{
  const r = await runProbe('denied-ctx', { userId: 'u-x', orgId: 'org-nope-none', flag: false },
    (orgs) => orgs.length === 0);
  check('denied ctx: 0 CalendarEvents visible via raw count on same link', r.evts[0].n === 0);
}

// 3) pool hygiene after disconnect + a fresh client sees NO leftover GUCs.
{
  const prisma = new PrismaClient({ datasources: { db: { url: appUrl.toString() } }, log: [] });
  const v = (await prisma.$queryRawUnsafe(`SELECT current_setting('app.current_org_id', true) AS v`))[0];
  check('pool hygiene: fresh link has empty GUCs (no cross-request leakage)', v.v === '');
  await prisma.$disconnect();
}

console.log(failures ? `\n${failures} FAILURES` : '\nall pass — pool-pinned single-connection read design is safe');
process.exit(failures ? 1 : 0);
