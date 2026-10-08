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

describe('bearer token access', () => {
  afterAll(async () => {
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
});
