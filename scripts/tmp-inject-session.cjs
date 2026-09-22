// Insert a live session row for the super-admin user so API endpoints can be
// probed without relying on interactive sign-in from a script. Outputs nothing sensitive.
const fs = require('fs');
const path = require('path');
const root = '/Users/johnlynas/dev/nipp-0807';
process.chdir(root);
const { Client } = require('pg');

(async () => {
  const c = new Client({ host: 'localhost', port: 5432, user: 'postgres', password: 'postgres', database: 'nipp_dev' });
  await c.connect();
  const userId = 'cmu42bsk5002pp9dtkngc8l4d'; // from prior verified query (paste #4 + above)
  const sessionId = 'sess-phase3-probe';
  const token = 'phase3probe_token_8f3a2b67c9d4e1';
  const now = new Date(Date.now() + 3600e3).toISOString();

  const del = await c.query('DELETE FROM "Session" WHERE id = $1', [sessionId]);
  console.log('cleared prior probe session:', del.rowCount);
  const ins = await c.query(
    'INSERT INTO "Session" ("id","expiresAt","token","createdAt","updatedAt","ipAddress","userAgent","userId") VALUES ($1,$2,$3,now(),now(),$4,$5,$6)',
    [sessionId, now, token, '127.0.0.1', 'rls-verify', userId]
  );
  console.log('inserted:', ins.command, ins.rowCount);
  await c.end();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
