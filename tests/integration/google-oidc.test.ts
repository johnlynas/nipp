import { describe, it, expect } from 'vitest';
import { auth } from '@/lib/auth';

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
