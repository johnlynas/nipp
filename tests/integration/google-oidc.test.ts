import { describe, it, expect, afterAll } from 'vitest';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * Google OIDC — server-side provider wiring (Phase 1).
 *
 * BetterAuth's `/sign-in/social` reads `provider` from the JSON body and replies
 * with a `Location` header (plus { url, redirect: true } in the body; in this
 * better-auth/minimal build the status is 200 rather than 30x). Accepting any
 * 2xx/3xx with an accounts.google.com Location proves the provider is wired.
 */
function socialSignInRequest(provider: string): Request {
  return new Request('http://localhost:3000/api/auth/sign-in/social', {
    method: 'POST',
    headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, callbackURL: 'http://localhost:3000/' }),
  });
}

describe('Google OIDC — sign-in redirect', () => {
  it('redirects to accounts.google.com when provider=google', async () => {
    const response = await auth.handler(socialSignInRequest('google'));
    expect(response.status >= 200 && response.status < 400).toBe(true);
    expect(response.headers.get('location') ?? '').toContain('accounts.google.com');

    // The JSON payload mirrors the redirect for clients that don't follow headers.
    const body = (await response.json()) as { url?: string; redirect?: boolean };
    expect(body.redirect).toBe(true);
    expect(body.url ?? '').toContain('accounts.google.com');
  });

  it('rejects an unknown provider', async () => {
    const response = await auth.handler(socialSignInRequest('facebook'));
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});

describe('Google OIDC — callback reachability', () => {
  it('serves the google callback without an auth redirect', async () => {
    const request = new Request(
      'http://localhost:3000/api/auth/callback/google?code=fake-code&state=dummy-state',
      { headers: { Origin: 'http://localhost:3000' } },
    );
    const response = await auth.handler(request);
    // The fake code/state never reach Google — we only assert the route is wired.
    // A 302 to /api/auth/error?error=state_mismatch proves BetterAuth's own state
    // validation ran (good: no middleware-level auth redirect swallowed us).
    const location = response.headers.get('location') ?? '';
    expect(location).not.toContain('/login');
    if (response.status === 302) {
      expect(location).toContain('/api/auth/error?error=state_mismatch');
    } else {
      await response.body?.cancel();
    }
  });
});

describe('Google OIDC — ban enforcement on social sign-in', () => {
  // Per the design doc (§5.1), ban enforcement for social sign-in lives in
  // databaseHooks.session.create.before, fed by the shared enforceBanStatus
  // helper (lib/auth). The email-side route hook shares the same helper, so a
  // banned user is rejected at session creation on BOTH doors with one code path.

  const userId = 'clx_banned_google_1';

  afterAll(async () => {
    await prisma.account.deleteMany({ where: { id: `${userId}-acc` } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it('rejects a banned user on google sign-in', async () => {
    await prisma.user.upsert({
      where: { id: userId },
      create: { id: userId, name: 'B', email: 'banned.google@example.com' },
      update: {},
    });
    await prisma.account.create({
      data: {
        id: `${userId}-acc`,
        accountId: `${userId}-acc`,
        providerId: 'google',
        providerAccountId: 'g-sub-banned',
        userId,
      },
    });
    await prisma.user.update({
      where: { id: userId },
      data: { banned: true, banReason: 'Fraud', banExpires: new Date(Date.now() + 86400_000) },
    });

    const { enforceBanStatus } = await import('@/lib/auth');
    // The session.create.before hook calls this per sign-in; it must throw with
    // the exact APIError shape the login page's banned-banner detection expects.
    await expect(enforceBanStatus('banned.google@example.com')).rejects.toThrow(/Access denied/);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.banned).toBe(true); // flag untouched for an active ban
  });

  it('clears the flag when a ban has expired', async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { banned: true, banReason: 'Fraud', banExpires: new Date(Date.now() - 1000) },
    });

    const { enforceBanStatus } = await import('@/lib/auth');
    await expect(enforceBanStatus('banned.google@example.com')).resolves.toEqual(undefined);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.banned).toBeFalsy();
    expect(user?.banReason).toBeNull();
    expect(user?.banExpires).toBeNull();
  });
});
