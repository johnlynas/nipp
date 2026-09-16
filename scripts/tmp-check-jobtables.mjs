// Temp: verify the active dev DB has job-scheduler tables. READ-ONLY — deletes nothing. Delete after use.
import { readFileSync } from 'node:fs';
const envMap = {};
for (const l of readFileSync('.env', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=["']?(.*)["']?\s*$/);
  if (m && !l.trim().startsWith('#')) envMap[m[1]] = m[2];
}
let url = (envMap.DATABASE_URL ?? '').split('?')[0];
const { Client } = await import('pg');
const c = new Client({ connectionString: url });
await c.connect();
const r = await c.query(`
  select table_name from information_schema.tables
  where table_schema='public' and table_name in ('JobDefinition','JobExecution')`);
console.log('tables:', r.rows.map((x) => x.table_name).sort().join(', ') || '(none)');
if (r.rows.length) {
  const cnt = await c.query(`select count(*) as n from "JobDefinition"`);
  console.log('JobDefinition rows:', cnt.rows[0].n);
}
await c.end();
