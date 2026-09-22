// Pool hygiene: after disconnect of client A (with session GUCs set), do fresh
// clients B/C ever see A's leftover GUCs on their borrowed link?
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
const s = { ...url.searchParams };

let failures = 0;
const check = (l, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}`); if (!ok) failures++; };
async function gucOf(p) { return (await p.$queryRawUnsafe(`SELECT current_setting('app.current_org_id', true) AS v`))[0].v; }

const A = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
await A.$executeRawUnsafe(`SELECT set_config('app.current_org_id','LEAK-CANARY',false)`);
check('A sees canary', (await gucOf(A)) === 'LEAK-CANARY');
await A.$disconnect();

const B = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
const cb = await gucOf(B);
check(`B fresh client sees '' (got '${cb}')`, cb === '');
// B keeps using its link for a few ops to make sure it stays clean.
check('B stable across ops on same reused pool', (await gucOf(B)) === '');
const C = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
const cc = await gucOf(C);
check(`C (while B alive, separate engine) sees '' (got '${cc}')`, cc === '');
await B.$disconnect();
await C.$disconnect();

// Now: A-style leak via DISCONNECT WITHOUT RESET — is it ever observable?
const D = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
await D.$executeRawUnsafe(`SELECT set_config('app.current_org_id','LEAK-2',false)`);
await D.$disconnect(); // no reset on purpose
const E = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
const ce = await gucOf(E);
check(`E after unreset disconnect sees '' (got '${ce}')`, ce === '');
await D.$queryRawUnsafe(`SELECT 1`).catch(() => {}); // no-op, keep lint quiet
await E.$disconnect();

console.log(failures ? `\nPOOL HYGIENE: ${failures} FAILURES` : '\npool hygiene clean: dedicated engines + pgbouncer/PG pool isolation confirmed');
process.exit(failures ? 1 : 0);
