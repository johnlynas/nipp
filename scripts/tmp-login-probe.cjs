// Post-cutover verification: login + /me + super-admin API endpoint (previously 403).
const fs = require('fs');
const BASE = 'http://localhost:3000';
const raw = fs.readFileSync(process.argv[2], 'utf8');
const EMAIL = raw.match(/email:\s*([^\s]+)/)?.[1];
const PASSWORD = raw.match(/password:\s*([^\s]+)/)?.[1];
if (!EMAIL || !PASSWORD) { console.log('could not parse credentials'); process.exit(1); }

function cookieFrom(res) {
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return sc.map(c => String(c).split(';')[0]).join('; ');
}

async function api(path, cookie) {
  const r = await fetch(`${BASE}${path}`, { headers: { cookie, origin: BASE } });
  let body; try { body = JSON.parse(await r.text()); } catch { body = null; }
  const n = Array.isArray(body?.items) ? ` items=${body.items.length}` : '';
  console.log(`GET ${path} ->`, r.status, n);
  if (r.status !== 200 && body) console.log('   body:', JSON.stringify(body).slice(0, 150));
}

(async () => {
  const login = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE, referer: `${BASE}/login` },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  console.log('sign-in:', login.status);
  if (login.status !== 200) { console.log('body:', (await login.text()).slice(0, 300)); process.exit(1); }
  const cookie = cookieFrom(login);

  await api('/api/auth/me', cookie);
  await api('/api/dashboard/admin/users?page=1&pageSize=8', cookie);
  await api('/api/dashboard/admin/organizations?page=1&pageSize=8', cookie);
  await api('/api/notifications/stream', cookie).catch(() => {}); // SSE: just status
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
