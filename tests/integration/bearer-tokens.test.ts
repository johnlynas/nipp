import { describe, it, expect, afterAll } from 'vitest';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { hashPassword } from 'better-auth/crypto';

/**
 * Bearer-token remote access (Phase 1, plan Task 1).
 *
 * Pins the core behavior of the BetterAuth `bearer()` plugin in ONE integration
 * test at a time (each later plan task appends here):
 *   ① A cookie sign-in response carries the `set-auth-token` response header
 *      (the bearer plugin's after-hook emits it whenever a session cookie is set).
 *   ② That exact string authenticates a protected endpoint via the standard
 *      `Authorization: Bearer *** — no cookies involved.
 *
 * The test drives the REAL auth handler end-to-end against the dev database,
 * reusing the seeding shape of tests/integration/google-oidc-full-flow.test.ts
 * (prisma.user upsert + credential Account row with a hashed password). No
 * mock seams are needed: everything is exercised through real
 * `auth.handler(req)` requests/responses.
 */

const BEARER_EMAIL = 'bearer.tokens@example.com';
const BEARER_PASSWORD = 'BearerTokens123!';

/** Canonical credential account (same shape as the OIDC full-flow file). */
async function seedLocalUser(): Promise<string> {
  const user = await prisma.user.upsert({
    where: { email: BEARER_EMAIL },
    create: { name: 'Bearer Tokens', email: BEARER_EMAIL },
    update: {},
  });
  await prisma.account.upsert({
    where: { providerId_accountId: { providerId: 'credential', accountId: user.id } },
    create: { userId: user.id, accountId: user.id, providerId: 'credential', password: await hashPassword(BEARER_PASSWORD) },
    update: {},
  });
  return user.id;
}

/** Ordinary email/password sign-in via the real auth handler. */
async function signInWithPassword(email: string, password: string): Promise<Response> {
  const handler = auth.handler as (req: Request) => Promise<Response>;
  return await handler(
    new Request('http://localhost/api/auth/sign-in/email', {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),
  );
}

/** Call a protected endpoint with ONLY the bearer header (no cookies). */
async function getMeWithBearer(token: string): Promise<Response> {
  const handler = auth.handler as (req: Request) => Promise<Response>;
  return await handler(
    new Request('http://localhost/api/auth/get-session', {
      headers: { Authorization: `Bearer ${token}` },
    }),
  );
}

/**
 * Assert a response carries NO resolved session and did not crash (5xx).
 *
 * In this BetterAuth build an unauthenticated /get-session reports as "no
 * session" — a 2xx with an empty/null body — NOT HTTP 401. The security
 * invariant we pin for bearer edge cases is therefore two-fold: (a) no user is
 * ever resolved, and (b) the request never surfaces a 5xx crash. This catches
 * both "a malformed/revoked token authenticated" and "a bad header threw".
 */
async function expectUnauthed(res: Response): Promise<void> {
  expect(res.status, `status was ${res.status}`).toBeLessThan(500);
  const text = await res.text();
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { /* empty body — no session */ }
  const hasUser = !!body && typeof body === 'object' && (body as Record<string, unknown>).user != null;
  expect(hasUser, `expected no resolved session but got: ${text}`).toBe(false);
}

/** Clear the shared fixture's ban state (idempotent). */
async function clearBan(): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email: BEARER_EMAIL } });
  if (user?.banned) {
    await prisma.user.update({
      where: { id: user.id },
      data: { banned: false, banReason: null, banExpires: null },
    });
  }
}

describe('bearer token access', () => {
  afterAll(async () => {
    await clearBan(); // safety net: never leave the fixture banned on a failed run
    const user = await prisma.user.findUnique({ where: { email: BEARER_EMAIL } });
    if (user) {
      await prisma.session.deleteMany({ where: { userId: user.id } });
      await prisma.account.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it('cookie sign-in response exposes set-auth-token, which authenticates get-session', async () => {
    await seedLocalUser();

    const res = await signInWithPassword(BEARER_EMAIL, BEARER_PASSWORD);
    expect(res.status).toBeLessThan(300);

    // The bearer plugin's after-hook must emit the session token in-band.
    const setAuthToken = res.headers.get('set-auth-token');
    expect(setAuthToken, 'set-auth-token response header should be present').toBeTruthy();

    // The same string authenticates a protected route with zero cookies.
    const me = await getMeWithBearer(setAuthToken!);
    expect(me.status).toBe(200);
    const body = await me.json();
    expect(body.user.email).toBe(BEARER_EMAIL);
  }, 30000);

  it('no dedicated on-demand token re-issue exists — a Bearer client mints a fresh usable token via sign-in (and the sign-in body carries {token})', async () => {
    // NOTE: design doc §4.2 references POST /api/auth/get-access-token as an
    // on-demand session-token re-issue. In the installed better-auth@1.6.23 that
    // endpoint is the PROVIDER OAuth token endpoint (body requires providerId,
    // returns {accessToken} of the linked IdP — verified in node_modules/better-
    // auth/dist/api/routes/account.mjs), NOT a "re-issue my bearer token" route.
    // There is no dedicated re-issue endpoint. The real v1 mechanic for a
    // Bearer client that needs a fresh token (max-age expired, revoked) is to
    // authenticate over HTTP again — no cookies involved. This test pins that,
    // plus the script-friendliness bonus that email sign-in ALSO returns the
    // session token inline as {token} in the JSON body.
    await seedLocalUser();

    const first = await signInWithPassword(BEARER_EMAIL, BEARER_PASSWORD);
    expect(first.status).toBe(200);
    const t1 = first.headers.get('set-auth-token');
    expect(t1).toBeTruthy();

    // Re-authenticate over plain HTTP (a script can always do this): a NEW session
    // row with a fresh token is minted and the old string stays valid until ITS
    // own expiry/revocation. This is exactly how a long-running client recovers
    // from a 401 without any cookies.
    const second = await signInWithPassword(BEARER_EMAIL, BEARER_PASSWORD);
    expect(second.status).toBe(200);

    // Scriptable acquisition: the token is in the JSON body too (not only the header).
    const body = await second.json();
    expect(body.token).toBeTruthy();

    // Header emission and a fresh usable string.
    const t2 = second.headers.get('set-auth-token');
    expect(t2).toBeTruthy();
    const me = await getMeWithBearer(t2!);
    expect(me.status).toBe(200);
  }, 30000);

  it('sign-out revokes the bearer token immediately', async () => {
    // A stolen token dies at sign-out: the Session row is deleted, so the bearer
    // string fails every subsequent lookup. This is the theft-damage control from
    // design §4.3/§5.1. We sign out *by* bearer to also prove a bearer-driven
    // sign-out works end-to-end.
    await seedLocalUser();
    const handler = auth.handler as (req: Request) => Promise<Response>;

    const signin = await signInWithPassword(BEARER_EMAIL, BEARER_PASSWORD);
    expect(signin.status).toBeLessThan(300);
    const t = signin.headers.get('set-auth-token');
    expect(t).toBeTruthy();

    const out = await handler(
      new Request('http://localhost/api/auth/sign-out', {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}` },
      }),
    );
    expect(out.status).toBeLessThan(300);

    // Same string, post sign-out: must be dead (no session resolved, no crash).
    const after = await getMeWithBearer(t!);
    await expectUnauthed(after);
  }, 30000);

  it('malformed / missing Authorization headers produce no session, never 500', async () => {
    // A bad header must degrade to "unauthenticated" (no resolved session), and
    // the request must never surface a server error — design §5.1. NOTE: in
    // better-auth@1.6.23 an unauthenticated /get-session answers 2xx with an
    // empty body, not HTTP 401; expectUnauthed pins the real invariant (no user +
    // no 5xx).
    const handler = auth.handler as (req: Request) => Promise<Response>;
    for (const header of [undefined, 'NotAToken abc', 'Bearer ', 'Basic xyz']) {
      const res = await handler(
        new Request('http://localhost/api/auth/get-session', {
          ...(header ? { headers: { Authorization: header } } : {}),
        }),
      );
      await expectUnauthed(res);
    }
  }, 30000);

  it('banned user sign-in yields no set-auth-token (ban gate blocks bearer acquisition)', async () => {
    // Design §5.1: the ban gate sits at session creation — the single funnel for
    // EVERY sign-in method — so a banned user cannot obtain a bearer token
    // through any door. Pinned here for the email/password door; if a future
    // change lets a banned identity mint a token, this fails. The `finally`
    // lift keeps the shared fixture usable even when an assertion fails first.
    await seedLocalUser();
    const user = (await prisma.user.findUnique({ where: { email: BEARER_EMAIL } }))!;

    await prisma.user.update({
      where: { id: user.id },
      data: { banned: true, banReason: 'test', banExpires: new Date(Date.now() + 86400_000) },
    });
    try {
      const priorSessions = await prisma.session.count({ where: { userId: user.id } });

      const res = await signInWithPassword(BEARER_EMAIL, BEARER_PASSWORD);
      expect(res.status, `banned sign-in should be rejected, got ${res.status}`).toBeGreaterThanOrEqual(400);

      // No token in-band (header) — the session was never created.
      expect(res.headers.get('set-auth-token'), 'no set-auth-token for a banned sign-in').toBeNull();

      // And no NEW Session row survived this attempt (baseline accounts for
      // sessions earlier tests in this file legitimately created).
      const sessions = await prisma.session.count({ where: { userId: user.id } });
      expect(sessions, 'banned sign-in must not create a Session row').toBe(priorSessions);
    } finally {
      await clearBan();
    }
  }, 30000);

  it('auth responses do not grant arbitrary-origin CORS', async () => {
    // Design §5.2: the portal must NOT echo origins or blanket-grant * —
    // browser third-party access is out of scope by design (customer BFF
    // pattern). This locks in that decision: any future "just allow CORS
    // quickly" change on /api/auth/** fails here instead of shipping silently.
    // Verified today: app code sets no ACAO, and in installed better-auth@1.6.23
    // only the (unregistered) mcp plugin sets one — so this asserts null.
    const res = await signInWithPassword(BEARER_EMAIL, BEARER_PASSWORD);
    expect(res.headers.get('Access-Control-Allow-Origin'), 'no ACAO grant on auth responses').toBeNull();
  }, 30000);
});

describe('bearer over a non-localhost host (public-access pin)', () => {
  // Phase B pin: with the env-driven dynamic baseURL, a request arriving on an
  // EXTERNAL host must behave identically to loopback — base URL + trusted
  // origins resolve per-request from the incoming Host header. If a future
  // change regresses us to a static base (e.g. re-enabling BETTER_AUTH_URL),
  // this fails: trusted origins freeze to one host and external sign-ins break.
  it('sign-in + get-session work on an arbitrary reachable host, cross-host session replay included', async () => {
    await seedLocalUser();
    const handler = auth.handler as (req: Request) => Promise<Response>;

    // Sign in over an external-style domain (no localhost in sight).
    const res = await handler(
      new Request('http://remote-client.example.com/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: BEARER_EMAIL, password: BEARER_PASSWORD }),
      }),
    );
    expect(res.status, `external-host sign-in should succeed, got ${res.status}`).toBeLessThan(300);
    const token = res.headers.get('set-auth-token');
    expect(token).toBeTruthy();

    // Replay the SAME token from a DIFFERENT host — public clients move between
    // IPs/domains; the bearer string must stay valid (no per-host binding).
    const me = await handler(
      new Request('http://192.168.99.5:3000/api/auth/get-session', {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(me.status).toBe(200);
    const body = await me.json();
    expect(body.user.email).toBe(BEARER_EMAIL);
  }, 30000);
});

describe('bearer token lifetime & refresh (Phase G)', () => {
  it('bearer token slides to a fresh 1h window once activity lands inside the updateAge window', async () => {
    // Renewal condition (verified in installed better-auth@1.6.23, dist/api/routes/session.mjs):
    // fires only when expiresAt - expiresIn + updateAge <= now, i.e. during the
    // final 15 min of the 1h window (session.updateAge = 900s). A FRESH session
    // is therefore NOT renewed on its next call — this test ages the Session row
    // into the renewal window first (direct DB update, same shared-dev-DB
    // technique the ban tests in this file use), mirroring a real long-lived
    // client whose token has been alive ~56 minutes. On renewal, better-auth
    // updates expiresAt IN PLACE to now+1h — the bearer string is unchanged and
    // no re-authentication happens (client-visible: no 401, same header works).
    await seedLocalUser();

    const signin = await signInWithPassword(BEARER_EMAIL, BEARER_PASSWORD);
    expect(signin.status).toBeLessThan(300);
    const t = signin.headers.get('set-auth-token')!;
    expect(t).toBeTruthy();

    // Age the newest Session row into the renewal window: 4 min of its 1h left.
    // (Keyed by userId on purpose: the set-auth-token transport value is a
    // signed/wrapped form of the raw Session.token column — no need to invert it.)
    const user = await prisma.user.findUnique({ where: { email: BEARER_EMAIL } });
    const row = (await prisma.session.findMany({ where: { userId: user!.id }, orderBy: { createdAt: 'desc' }, take: 1 }))[0];
    expect(row).toBeTruthy(); // sign-in above must have created it
    await prisma.session.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() + 4 * 60_000) } });

    // Activity NOW: same bearer string, no re-auth — and the response carries a
    // FRESH expiry (~now+1h), proving the in-place slide happened. (A pre-window
    // renewal gap is what dies per design §4.3 — this pins the surviving path.)
    const me = await getMeWithBearer(t);
    expect(me.status).toBe(200);
    const body = (await me.json()) as { session: { expiresAt: string } };
    const remainingMs = new Date(body.session.expiresAt).getTime() - Date.now();
    // Renewed ≈ 1h window (allowing clock skew + handler latency): comfortably
    // more than 50 min, and not stuck at the 4 min we aged it to.
    expect(remainingMs, `session was not renewed — only ${Math.round(remainingMs / 60_000)} min left`).toBeGreaterThan(50 * 60_000);
  }, 30000);
});
