import { Client } from 'pg';

const c = new Client({ host: 'localhost', port: 5432, user: 'postgres', password: 'postgres', database: 'nipp_dev' });
await c.connect();
const r = await c.query(
  `SELECT tablename, policyname, cmd,
     regexp_replace(coalesce(qual,'NULL'), '\\s+', ' ', 'g') AS qual
   FROM pg_policies ORDER BY tablename, policyname`
);
for (const x of r.rows) {
  console.log(`${x.tablename} | ${x.policyname} [${x.cmd}] : ${x.qual}`);
}
console.log(`--- total policies: ${r.rowCount}`);
await c.end();
