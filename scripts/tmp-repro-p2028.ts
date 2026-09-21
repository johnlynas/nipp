// Repro: live dev server P2028 — hammer /api/dashboard/admin/organizations
// (and the RSC page that renders it) concurrently.
// Usage: npx tsx scripts/tmp-repro-p2028.ts  (dev server must be running on :3000)
import { readFileSync } from 'node:fs';
for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)=(.*)$/.exec(line);
  if (!m) continue;
  let v = m[2].trim().replace(/\r$/, '');
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  process.env[m[1]] ??= v;
}

async function main(): Promise<void> {
const BASE = 'http://localhost:3000';
const email = process.env.TEST_ADMIN_EMAIL!;
const password = process.env.TEST_ADMIN_PASSWORD!;

// Sign in; collect every set-cookie (better-auth stores session cookie)
const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: BASE },
  body: JSON.stringify({ email, password }),
});
const body = await res.text().catch(() => '');
console.log(`sign-in: ${res.status} pwlen=${password.length} body=${body.slice(0, 160)}`);
if (res.status !== 200) process.exit(3);
const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
console.log(`sign-in: ${res.status}, session=${cookies ? 'yes' : 'NO'}`);

let sawP2028 = 0;
const responses: string[] = [];
async function hit(path: string): Promise<void> {
  try {
    const r = await fetch(`${BASE}${path}`, { headers: { cookie: cookies } });
    const text = await r.text().catch(() => '');
    if (text.includes('P2028') || text.includes('Transaction already closed')) sawP2028++;
    responses.push(`${r.status} ${path}`);
  } catch (e) {
    responses.push(`ERR ${path}: ${(e as Error).message}`);
  }
}

const MODE = process.argv[2] || 'mixed'; // api | page | mixed

// Wave 1: 6 concurrent API calls — the exact failing route, back-to-back Promise.all groups inside
if (MODE !== 'page') {
  await Promise.all([
    hit('/api/dashboard/admin/organizations?page=1&pageSize=8'),
    hit('/api/dashboard/admin/organizations?page=1&pageSize=8'),
    hit('/api/dashboard/admin/organizations?page=1&pageSize=8'),
    hit('/api/dashboard/admin/resources?pageSize=100'),
    hit('/api/dashboard/admin/resources?pageSize=1'),
    hit('/api/dashboard/admin/users?page=1&pageSize=8'),
  ]);
} else {
  // Sequential RSC page loads, back-to-back (dev double-render territory)
  for (let i = 0; i < 4; i++) await hit('/dashboard/admin/organizations');
}

console.log(responses.join('\n'));
console.log(sawP2028 ? `\nP2028 seen in ${sawP2028} response body(s)` : '\n(no P2028 in bodies — check server console for unhandledRejection)');
}

main().catch((e) => { console.error(e); process.exit(2); });
