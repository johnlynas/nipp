// one-off: probe dev nipp_dev RLS/migration state (delete after use)
import pg from 'pg';
import { readFileSync } from 'node:fs';
for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)=(.*)$/.exec(line);
  if (!m) continue;
  let v = m[2].trim().replace(/\r$/, '');
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  process.env[m[1]] ??= v;
}
const c = new pg.Client({ connectionString: 'postgresql://postgres:postgres@localhost:5432/nipp_dev', connectionTimeoutMillis: 5000 });
await c.connect();
const q = async (s) => (await c.query(s)).rows;
const has = async (sql, col) => { const r = await c.query(sql); return Number(r.rows[0][col]); };
console.log('_prisma_migrations exists:', (await q(`SELECT to_regclass('public._prisma_migrations') AS x`))[0].x);
console.log('policies:', JSON.stringify(await q(`SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname='public' ORDER BY 1,2`)));
console.log('rls-enabled tables:', await has(`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace nn ON nn.oid=c.relnamespace WHERE nn.nspname='public' AND c.relkind='r' AND c.relrowsecurity`, 'n'));
console.log('nipp_app role:', JSON.stringify(await q(`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('nipp_app','postgres')`)));
const ver = (await q('select version() as v'))[0].v; console.log('pg:', ver.split(',')[0]);
await c.end();
