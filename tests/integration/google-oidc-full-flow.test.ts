import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { MockInstance } from 'vitest';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';

/**
 * Google OIDC — full mocked flow (Phase 3, Task 6) + success-log wiring (Task 7).
 *
 * Drives the REAL auth handler end-to-end without live Google credentials:
 *   1. POST /sign-in/social → BetterAuth persists the flow state (PKCE codeVerifier +
 *      callbackURL JSON blob) to the Verification table and sets a `state` value as
 *      its identifier; we read that back directly (database state strategy).
 *   2. GET /callback/google?code=fake&state=<that> → the ONLY outbound call is the
 *      OAuth token exchange to oauth2.googleapis.com/token, stubbed via
 *      vi.spyOn(globalThis, 'fetch'). We answer with an id_token built locally:
 *      BetterAuth's google provider derives the user from a plain decodeJwt of
 *      id_token — signature verification is NOT part of this code path (verified in
 *      node_modules: validate-authorization-code.mjs uses jose only for its own
 *      separate validateToken helper, not here), so an alg:none token passes.
 *   3. Assert user + Account rows and the session cookie; then GET /session with
 *      that cookie to confirm BetterAuth resolves a real session (which executes
 *      the ExtendedSession callbacks).
 *   4. Banned-user case: ban BEFORE (first) sign-in of a RETURNING google identity →
 *      handleOAuthUserInfo resolves the linked Account, then createSession runs our
 *      databaseHooks.session.create.before → throw APIError('UNAUTHORIZED') → BetterAuth
 *      answers the callback with 401 'Access denied. …' (the exact message the login
 *      page's banned banner recognises) and NO session row is created.
 */

const TEST_EMAIL = 'full-flow.google@example.com';
const BANNED_EMAIL = 'full-flow.banned@gmail.com';
const GOOGLE_SUB = 'g-sub-full-flow';
const BANNED_SUB = 'g-sub-banned-flow';
const CALLBACK_URL = 'http://localhost:3000/dashboard/calendar';

// BetterAuth's google provider derives the user from decodeJwt(id_token) ONLY —
// no signature check on this path (verified in node_modules — see file header) —
// so a locally built, UNVERIFIED JWT (alg:none compact form) is sufficient and
// needs no keypair: base64url(header).base64url(payload).empty-signature.
function buildIdToken(email: string, sub: string): string {
  const b64 = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ typ: 'JWT', alg: 'none' });
  const payload = b64({
    sub,
    name: 'Flow Google',
    email,
    email_verified: true,
    picture: '',
    given_name: 'Flow',
    family_name: 'Google',
    iss: 'https://accounts.google.com',
    iat: now,
    exp: now + 300,
  });
  return `${header}.${payload}.`;
}

// BetterAuth stores the OAuth flow state in the Verification table (database
// strategy is the default) — identifier holds the `state` value, value holds the
// JSON blob (codeVerifier, callbackURL, … custom keys). sign-in/social accepts
// `additionalData`, which we set to a unique marker so lookups stay deterministic
// even when other test files write their own state rows concurrently.
async function findOAuthState(marker: string): Promise<string> {
  const row = await prisma.verification.findFirst({ where: { value: { contains: marker } } });
  if (!row) throw new Error(`No Verification row carrying marker ${marker}`);
  return row.identifier;
}

/**
 * Pull named cookies off a Response's Set-Cookie header(s). BetterAuth prefixes
 * cookie names with `__Secure-` when the Secure flag applies (this build does —
 * verified in the debug trace), so match on a suffix and round-trip the original
 * name verbatim.
 */
function extractSetCookie(res: Response): {
  sessionToken: string | null;
  sessionCookieName: string | null;
  stateCookie: string | null;
} {
  const raw = res.headers.getSetCookie?.() ?? [];
  let sessionToken: string | null = null;
  let sessionCookieName: string | null = null;
  let stateCookie: string | null = null;
  for (const c of raw) {
    const pair = c.slice(0, c.indexOf(';'));
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (name.endsWith('better-auth.session_token')) { sessionToken = value; sessionCookieName = name; }
    // Signed state cookie the database state strategy cross-checks against.
    if (name.endsWith('.state')) stateCookie = pair;
  }
  return { sessionToken, sessionCookieName, stateCookie };
}

function socialSignInRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost:3000/api/auth/sign-in/social', {
    method: 'POST',
    headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Sign-in → mock callback; reads flow state from the Verification table. */
async function runOAuthRoundTrip(t: (req: Request) => Promise<Response>, body: Record<string, unknown>) {
  const marker = `flowmarker-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const signResponse = await t(socialSignInRequest({ ...body, additionalData: { flowMarker: marker } }));
  expect(signResponse.status >= 200 && signResponse.status < 400).toBe(true);
  expect(signResponse.headers.get('location') ?? '').toContain('accounts.google.com');
  await signResponse.body?.cancel();

  const state = await findOAuthState(marker);
  const cookies = extractSetCookie(signResponse).stateCookie;
  return t(
    new Request(
      `http://localhost:3000/api/auth/callback/google?code=fake-auth-code&state=${encodeURIComponent(state)}`,
      // The DB state strategy also cross-checks the signed state cookie set at sign-in.
      { headers: { Origin: 'http://localhost:3000', Cookie: cookies ?? '' } },
    ),
  );
}

describe('Google OIDC — full mocked flow (Task 6)', () => {
  const handler = auth.handler as (req: Request) => Promise<Response>;
  let tokenFetchMock: MockInstance;
  let infoSpy: MockInstance;

  beforeAll(() => {
    // Stub the ONLY outbound call: the OAuth token exchange. Everything else must
    // never touch the network (it would hit Google with test creds and fail).
    tokenFetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: string | Request | URL) => {
        const url = String(input);
        if (url.includes('oauth2.googleapis.com/token')) {
          return new Response(
            JSON.stringify({
              access_token: 'mock-access-token',
              id_token: currentIdToken,
              token_type: 'Bearer',
              expires_in: 3600,
              scope: 'openid email profile',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        throw new Error(`Unexpected outbound request in mocked OAuth flow: ${url}`);
      });
    // Pino instance — spying on .info lets us assert the Task 7 success log line.
    infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
  });

  afterAll(async () => {
    tokenFetchMock.mockRestore();
    infoSpy.mockRestore();
    for (const email of [TEST_EMAIL, BANNED_EMAIL]) {
      const user = await prisma.user.findUnique({ where: { email } });
      if (user) await prisma.session.deleteMany({ where: { userId: user.id } });
    }
    await prisma.account.deleteMany({
      where: { providerId: 'google', accountId: { in: [GOOGLE_SUB, BANNED_SUB] } },
    });
    await prisma.user.deleteMany({ where: { email: { in: [TEST_EMAIL, BANNED_EMAIL] } } });
  });

  it('new google identity → user + Account row + session cookie, redirect to callbackURL', async () => {
    currentIdToken = buildIdToken(TEST_EMAIL, GOOGLE_SUB);

    const cbRes = await runOAuthRoundTrip(handler, { provider: 'google', callbackURL: CALLBACK_URL });
    // Success redirects to the callbackURL stored in state — proves the full chain
    expect(cbRes.status).toBe(302);
    expect(cbRes.headers.get('location')).toBe(CALLBACK_URL);

    const { sessionToken, sessionCookieName } = extractSetCookie(cbRes);
    expect(sessionToken, 'session cookie should be set on successful callback').toBeTruthy();
    await cbRes.body?.cancel();

    // Rows in the DB (implicit sign-up is allowed per-provider even though
    // emailAndPassword.disableSignUp blocks the password endpoint)
    const user = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
    expect(user).not.toBeNull();
    expect(user?.emailVerified).toBe(true); // from id_token email_verified
    const account = await prisma.account.findFirst({
      where: { providerId: 'google', accountId: GOOGLE_SUB },
    });
    expect(account).not.toBeNull();
    expect(account?.userId).toBe(user?.id);
    expect(account?.accountId).toBe(GOOGLE_SUB);

    // Task 7 observability: session.create.after logs the social success (the only
    // legal hook — GoogleOptions has no onSuccess in better-auth@1.6.x)
    const successLog = infoSpy.mock.calls.find(
      (call: unknown[]) => String(call[1]) === '[Auth] Google sign-in succeeded',
    );
    expect(successLog, 'google sign-in success log missing').toBeDefined();

    // The cookie is a REAL session — resolve it through BetterAuth's own
    // session machinery (the same call /api/auth/me makes; ExtendedSession
    // callbacks included).
    const session = await auth.api.getSession({
      headers: Object.fromEntries(
        new Headers({ Cookie: `${sessionCookieName}=${sessionToken}` }).entries(),
      ),
    });
    expect(session?.user?.email).toBe(TEST_EMAIL);
  }, 20000);

  it('re-login reuses the user — one User, no duplicate Account row', async () => {
    const accountsBefore = await prisma.account.count({ where: { accountId: GOOGLE_SUB } });

    currentIdToken = buildIdToken(TEST_EMAIL, GOOGLE_SUB);
    const cbRes = await runOAuthRoundTrip(handler, { provider: 'google', callbackURL: CALLBACK_URL });
    expect(cbRes.status).toBe(302);
    expect(cbRes.headers.get('location')).toBe(CALLBACK_URL);
    await cbRes.body?.cancel();

    // Email matching → same single User row, Account rows unchanged
    const users = await prisma.user.findMany({ where: { email: TEST_EMAIL } });
    expect(users.length).toBe(1);
    const accountsAfter = await prisma.account.count({ where: { accountId: GOOGLE_SUB } });
    expect(accountsAfter).toBe(accountsBefore);
  }, 20000);

  it('banned user is rejected at session creation — no session, 401 with the banned-banner message', async () => {
    // Seed a returning google user who is banned BEFORE this sign-in.
    await prisma.user.upsert({
      where: { email: BANNED_EMAIL },
      create: { name: 'Banned Flow', email: BANNED_EMAIL, banned: true, banReason: 'Fraud', banExpires: new Date(Date.now() + 86400_000) },
      update: {},
    });
    const seeded = await prisma.user.findUnique({ where: { email: BANNED_EMAIL } });
    await prisma.account.upsert({
      where: { providerId_accountId: { providerId: 'google', accountId: BANNED_SUB } },
      create: { accountId: BANNED_SUB, providerId: 'google', userId: seeded!.id },
      update: {},
    });

    currentIdToken = buildIdToken(BANNED_EMAIL, BANNED_SUB);

    const cbRes = await runOAuthRoundTrip(handler, {
      provider: 'google',
      callbackURL: CALLBACK_URL,
      errorCallbackURL: '/login?oidc=error',
    });

    // session.create.before threw APIError('UNAUTHORIZED'). BetterAuth surfaces a
    // thrown APIError from inside the OAuth callback as a plain 401 (not an
    // ?error= redirect) carrying the exact 'Access denied. …' message the login
    // page's banned banner already recognises.
    expect(cbRes.status).toBe(401);
    const bodyText = await cbRes.text();
    expect(bodyText).toContain('Access denied');
    // No session cookie is issued for the rejected identity.
    expect(extractSetCookie(cbRes).sessionToken).toBeFalsy();

    // No session was issued for the banned user.
    const sessions = await prisma.session.findMany({ where: { userId: seeded!.id } });
    expect(sessions.length).toBe(0);
  }, 20000);
});

// Identity whose id_token the mocked token endpoint returns; set by each test right
// before its round-trip (the endpoint is stubbed once in beforeAll).
let currentIdToken = '';
