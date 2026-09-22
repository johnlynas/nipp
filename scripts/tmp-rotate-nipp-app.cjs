// Rotate nipp_app DB password via pg driver. No secret echoes — verifies only role + count.
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const root = '/Users/johnlynas/dev/nipp-0807';
process.chdir(root);
const { Client } = require(path.join(root, 'node_modules/pg'));

(async () => {
  const s = fs.readFileSync(path.join(root, '.env'), 'utf8');
  const newPass = crypto.randomBytes(16).toString('base64url');

  // Connect as owner; set nipp_app password. Utility statements can't take
  // server-side parameters in node-pg — interpolate the fresh base64url token
  // (no quoting hazard; value is never logged).
  const escPass = newPass.replace(/'/g, "''");
  const c = new Client({ host: 'localhost', port: 5432, user: 'postgres', password: 'postgres', database: 'nipp_dev' });
  await c.connect();
  await c.query(`ALTER ROLE nipp_app WITH PASSWORD '${escPass}'`);
  await c.end();

  // Swap both .env lines (password var + in-URL copy). Never print secrets.
  let updated = s.replace(/NIPP_APP_DB_PASSWORD="[^"]+"/, `NIPP_APP_DB_PASSWORD="${newPass}"`);
  updated = updated.replace(/(nipp_app:)[^@]+(@)/g, (_m, a, b) => a + newPass + b);
  if (!/DATABASE_URL="postgresql:\/\/nipp_app:[^@]+@/.test(updated)) throw new Error('URL swap failed');
  fs.writeFileSync(path.join(root, '.env'), updated);

  // Verify app-role connectivity with the NEW password; output only role + counts.
  const v = new Client(`postgresql://nipp_app:${newPass}@localhost:5432/nipp_dev`);
  await v.connect();
  const r = await v.query('SELECT current_user AS u, (SELECT count(*) FROM "Organization")::int AS orgs');
  console.log('rotated + verified:', JSON.stringify(r.rows[0]));
  await v.end();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
