// Critical question: does ONE raw interactive-tx client (itx) tolerate N
// CONCURRENT model ops? If yes, service-level real $transaction blocks are safe
// on the pinned link without any extra serialization.
import { readFileSync } from 'node:fs';
for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)=(.*)$/.exec(line);
  if (!m) continue;
  let v = m[2].trim().replace(/\r$/, '');
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  process.env[m[1]] ??= v;
}
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');

const url = new URL(process.env.DATABASE_URL);
url.username = 'nipp_app';
if (process.env.NIPP_APP_DB_PASSWORD) url.password = process.env.NIPP_APP_DB_PASSWORD;
url.searchParams.set('connection_limit', '10');

let failures = 0;
const check = (l, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}`); if (!ok) failures++; };

async function main() {
  const p = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
  // Session GUCs on the pool link that itx will borrow.
  await p.$executeRawUnsafe(`SELECT set_config('app.is_platform_admin','1',false), set_config('app.current_org_id','',false)`);

  for (const wave of [0, 1, 2, 3]) {
    let ok = 0, err = null;
    try {
      const res = await p.$transaction(async (tx) => {
        // 6 concurrent siblings on the itx — the exact service-list shape PLUS writes
        return Promise.all([
          tx.organization.count(),
          tx.organization.groupBy({ by: ['status'], _count: { status: true } }),
          tx.resource.findMany({ take: 5 }),
          tx.user.count(),
          tx.team.count(),
          tx.calendarEvent.count(),
        ]);
      });
      ok = 1;
      check(`wave ${wave}: 6 concurrent itx siblings -> [${res[0]} | ${JSON.stringify(res[1].map(r=>r.status))} | res=${res[2].length} | users=${res[3]} | teams=${res[4]} | events=${res[5]}]`, true);
    } catch (e) {
      err = e;
      check(`wave ${wave}: itx sibling race -> ${(e.message || '').split('\n')[0]}`, false);
    }
    if (!ok) break;
  }

  await p.$disconnect();
  console.log(failures ? `\nITX CONCURRENT OPS NOT SAFE (${failures} failures)` : '\nitx concurrent siblings are SAFE on the raw client');
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
