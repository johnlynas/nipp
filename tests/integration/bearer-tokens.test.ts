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
});
