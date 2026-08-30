/**
 * Debug script: log in via the real login form, then visit the Notifications
 * Log page and report the Live/Disconnected badge + all [useNotifications]
 * / SSE console output from the actual browser session.
 *
 * Run:  node scripts/debug-notifications-login.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
// Credentials come from the environment — never hardcode them in the repo.
const EMAIL = process.env.LOGIN_EMAIL;
const PASSWORD = process.env.LOGIN_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error('Usage: LOGIN_EMAIL=... LOGIN_PASSWORD=*** node scripts/debug-notifications-login.mjs');
  process.exit(2);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

const consoleLines = [];
page.on('console', (msg) => {
  const text = msg.text();
  if (/useNotifications|SSE|notifications/i.test(text)) {
    consoleLines.push(`[${msg.type()}] ${text}`);
  }
});
// Capture failed network requests (e.g. the SSE fetch itself)
const failed = [];
page.on('requestfailed', (req) => {
  failed.push(`${req.method()} ${req.url()} -> ${req.failure()?.errorText}`);
});
const apiStatuses = [];
page.on('response', (res) => {
  if (res.url().includes('/api/')) {
    apiStatuses.push(`${res.status()} ${res.request().method()} ${new URL(res.url()).pathname}`);
  }
});

// --- 1. Login page, fill form, submit -----------------------------------
await page.goto(`${BASE}/login`, { waitUntil: 'load', timeout: 30_000 });
console.log('login page loaded:', page.url());

await page.getByLabel('User ID (Email)').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
try {
  await page.getByLabel('User ID (Email)')
    .fill(EMAIL, { timeout: 10_000 });
  console.log('filled email field via label "User ID (Email)"');
} catch {
  // Fallback: find the email input by type/name
  const emailInput = page.locator('input[type="email"], input[name*="email" i], input[id*="email" i]').first();
  await emailInput.fill(EMAIL, { timeout: 10_000 });
  console.log('filled email field via input[type=email] fallback');
}

let filledPass = false;
try {
  await page.getByLabel('Password').fill(PASSWORD, { timeout: 5_000 });
  filledPass = true;
  console.log('filled password field via label "Password"');
} catch {
  // expected — fall back to input[type=password] below
}
if (!filledPass) {
  const passInput = page.locator('input[type="password"]').first();
  await passInput.fill(PASSWORD, { timeout: 10_000 });
  console.log('filled password field via input[type=password] fallback');
}

await page.getByRole('button', { name: /sign in|log ?in/i }).click({ timeout: 10_000 });
console.log('clicked sign-in button');

// Wait for navigation away from /login (SSE/polling keep the page busy, so not networkidle)
await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20_000 }).catch(async () => {});
const loggedIn = !page.url().includes('/login');
console.log(loggedIn ? `LOGIN OK -> ${page.url()}` : `LOGIN FAILED — still on /login`);

if (!loggedIn) {
  // Dump any server error message the form shows
  const bodyText = await page.locator('body').innerText();
  console.log('--- page text ---\n' + bodyText.slice(0, 500));
  await browser.close();
  process.exit(1);
}

// --- 2. Visit the Notifications Log page and read the status badge -------
console.log('\n=== navigating to /dashboard/admin/notifications ===');
await page.goto(`${BASE}/dashboard/admin/notifications`, { waitUntil: 'load', timeout: 30_000 });

// Give the SSE fetch a moment to connect/fail/retry
await page.waitForTimeout(5000);

const badge = page.locator('text=/Live|Disconnected/').first();
let statusText = '(no status badge found)';
try {
  statusText = (await badge.innerText({ timeout: 5_000 })).trim();
} catch {
  // expected — if the badge never appears, statusText keeps its placeholder
}
console.log('\nSTATUS BADGE:', statusText);

// --- 3. Second sample after longer wait (reconnect backoff may kick in) ---
await page.waitForTimeout(8000);
try {
  const t2 = (await badge.innerText({ timeout: 5_000 })).trim();
  if (t2 !== statusText) console.log('STATUS AFTER ~13s WAIT:', t2);
} catch {
  // expected — badge may have disappeared between samples
}

// --- Reports ---------------------------------------------------------------
console.log('\n--- interesting console lines ---');
for (const l of consoleLines.slice(0, 40)) console.log(l);
if (!consoleLines.length) console.log('(none)');

console.log('\n--- failed requests ---');
console.log(failed.length ? failed.join('\n') : '(none)');

console.log('\n--- /api responses (first 25, last 15) ---');
const shown = [...apiStatuses.slice(0, 25), ...(apiStatuses.length > 40 ? ['...'] : []), ...apiStatuses.slice(-15)];
for (const s of shown) console.log(s);

await page.screenshot({ path: '/tmp/nipp-notifications.png', fullPage: false });
console.log('\nscreenshot: /tmp/nipp-notifications.png');

await browser.close();
