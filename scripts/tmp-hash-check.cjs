// Credential check: compare paste password to stored hash locally (BetterAuth default = scrypt).
const fs = require('fs');
const crypto = require('crypto');
process.chdir('/Users/johnlynas/dev/nipp-0807');
const { Client } = require('pg');

(async () => {
  const raw = fs.readFileSync('/Users/johnlynas/.hermes/pastes/paste_2_210455.txt', 'utf8');
  const EMAIL = raw.match(/email:\s*([^\s]+)/)?.[1];
  const PASSWORD = raw.match(/password:\s*([^\s]+)/)?.[1];

  const c = new Client({ host: 'localhost', port: 5432, user: 'postgres', password: 'postgres', database: 'nipp_dev' });
  await c.connect();
  const r = await c.query('SELECT "passwordHash" AS h FROM "User" WHERE email=$1', [EMAIL]);
  const hash = r.rows[0]?.h;
  console.log('user found:', r.rowCount > 0, '| hash format:', JSON.stringify((hash || '').split('$').slice(0, 3).join('$')));

  // BetterAuth scrypt default: N=131072 (2^17)? Actually better-auth uses crypto.scrypt with default params
  if (hash) {
    const [algo, salt, digest] = hash.split('$').slice(1);
    const pwBuf = Buffer.from(PASSWORD, 'utf8');
    // try scrypt with the stored salt; compare digests
    for (const N of [0]) { void N; }
    crypto.scrypt(pwBuf, Buffer.from(salt, 'hex'), 64, (err, derived) => {
      const ok = !err && derived.toString('hex') === digest?.toLowerCase();
      console.log('scrypt(password)==stored?:', ok);
    });
  }
  await c.end();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
