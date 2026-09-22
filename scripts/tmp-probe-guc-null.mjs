import { readFileSync } from 'node:fs';
for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)=(.*)$/.exec(line);
  if (!m) continue;
  let v = m[2].trim().replace(/\r$/, '');
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  process.env[m[1]] ??= v;
}
import pg from 'pg';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');

const url = new URL(process.env.DATABASE_URL);
url.username = 'nipp_app';
if (process.env.NIPP_APP_DB_PASSWORD) url.password = process.env.NIPP_APP_DB_PASSWORD;

// A) plain driver: what does the DB actually return for an unset custom GUC?
{
  const c = new pg.Client({ connectionString: url.toString() });
  await c.connect();
  const r = (await c.query(`SELECT current_setting('app.current_org_id', true) AS v`)).rows[0].v;
  console.log('plain pg unset GUC:', JSON.stringify(r), typeof r);
  await c.query(`SELECT set_config('app.current_org_id','canary',false)`);
  const r2 = (await c.query(`SELECT current_setting('app.current_org_id', true) AS v`)).rows[0].v;
  console.log('plain pg set GUC:', JSON.stringify(r2));
  await c.end();
}

// B) Prisma raw: how does ITS unpacker map the same values?
{
  const p = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
  const a = (await p.$queryRawUnsafe(`SELECT current_setting('app.current_org_id', true) AS v`))[0];
  console.log('prisma raw unset GUC:', JSON.stringify(a.v), typeof a.v);
  await p.$executeRawUnsafe(`SELECT set_config('app.current_org_id','canary',false)`);
  const b = (await p.$queryRawUnsafe(`SELECT current_setting('app.current_org_id', true) AS v`))[0];
  console.log('prisma raw set GUC:', JSON.stringify(b.v), typeof b.v);
  // And the policy shape — does the DB itself see '' vs canary correctly?
  const pol = (await p.$queryRawUnsafe(
    `SELECT (current_setting('app.current_org_id', true) = 'canary') AS eq_canary, (current_setting('app.is_platform_admin', true)::text IS NOT NULL) AS flagset`))[0];
  console.log('policy shape read:', JSON.stringify(pol));
  await p.$disconnect();
}
