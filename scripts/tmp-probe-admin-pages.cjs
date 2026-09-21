// Confirm the Phase-3 fix on the live app: hit /api/auth/me + the three
// previously-blank admin list endpoints using a real session token. Prints HTTP
// status + row counts only (no secrets). The super-admin user id is hardcoded
// from the DB probe, not from any paste.
const BASE = 'http://localhost:3000';
const COOKIE = 'better-auth.session_token=phase3probe_token_8f3a2b67c9d4e1; ';

async function get(path) {
  const r = await fetch(`${BASE}${path}`, { headers: { cookie: COOKIE, origin: BASE } });
  let body = null; try { body = JSON.parse(await r.text()); } catch {}
  let shape = 'n/a';
  if (body) {
    if (Array.isArray(body.items)) shape = `items=${body.items.length}`;
    else if (Array.isArray(body.users)) shape = `users=${body.users.length}`;
    else if (body.organizations) shape = `orgs=${(body.organizations ?? []).length}/total ${body.pagination?.total}`;
    else if (Array.isArray(body.permissions)) shape = `perms=${body.permissions.length}`;
    else if (Array.isArray(body.items ?? body.data?.items)) shape = `rows=${(body.items||body.data.items).length}`;
  }
  console.log(`GET ${path} ->`, r.status, shape);
  return { status: r.status, body };
}

(async () => {
  const me = await get('/api/auth/me');
  if (me.status !== 200) { console.log('  /me not authed — session may have expired; run sign-in in browser first.'); process.exit(0); }
  console.log(`  authenticated user id present:`, !!(me.body?.user));
  await get('/api/dashboard/admin/users?page=1&pageSize=8');
  await get('/api/dashboard/admin/permissions?page=1&pageSize=8');
  await get('/api/dashboard/admin/organizations?page=1&pageSize=8');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
