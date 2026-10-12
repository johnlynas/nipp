/**
 * Unit tests for lib/csrf.ts — true same-origin validation.
 *
 * PUBLIC ACCESS pin: isSameOriginRequest must accept a browser whose Origin is
 * a LAN IP / tunnel hostname (i.e. ANY host the request itself arrived on), not
 * only a configured FRONTEND_URL. That is what kept 403-ing the payload-key
 * endpoint — and therefore every PII-routed call — from non-localhost clients.
 */
import { describe, it, expect, vi } from 'vitest';

// lib/csrf reads env.NODE_ENV for its dev relaxation — pin the mode per test.
vi.mock('@/lib/env', () => ({
  env: { NODE_ENV: 'production' },
}));

import { isSameOriginRequest, isSameSiteRequest } from '@/lib/csrf';

const LAN_ORIGIN = 'http://169.254.63.242:3000';
const LOCAL_ORIGIN = 'http://localhost:3000';

function headersWith(extra: Record<string, string> = {}): Headers {
  return new Headers(extra);
}

describe('isSameOriginRequest (host-independent same-origin gate)', () => {
  it('accepts POST from a browser on a LAN IP origin that matches the request URL', () => {
    const ok = isSameOriginRequest(
      `${LAN_ORIGIN}/api/security/payload-key`,
      'POST',
      headersWith({ origin: LAN_ORIGIN }),
    );
    expect(ok).toBe(true);
  });

  it('accepts POST from a browser on localhost that matches the request URL', () => {
    const ok = isSameOriginRequest(
      `${LOCAL_ORIGIN}/api/security/payload-key`,
      'POST',
      headersWith({ origin: LOCAL_ORIGIN }),
    );
    expect(ok).toBe(true);
  });

  it('accepts a tunnel-hostname origin (same class as LAN IP — any reachable host)', () => {
    const ok = isSameOriginRequest(
      'https://portal.example.com/api/security/payload-key',
      'POST',
      headersWith({ origin: 'https://portal.example.com' }),
    );
    expect(ok).toBe(true);
  });

  it('rejects POST from a mismatched cross-site origin in production', () => {
    const ok = isSameOriginRequest(
      `${LAN_ORIGIN}/api/security/payload-key`,
      'POST',
      headersWith({ origin: 'https://evil.example.com' }),
    );
    expect(ok).toBe(false);
  });

  it('rejects POST from localhost origin when the request itself arrived on a LAN IP origin (the original bug, inverted)', () => {
    // If the server is serving http://169.254.63.242:3000 but something claims
    // Origin localhost, that is NOT same-origin with the serving host.
    const ok = isSameOriginRequest(
      `${LAN_ORIGIN}/api/security/payload-key`,
      'POST',
      headersWith({ origin: LOCAL_ORIGIN }),
    );
    expect(ok).toBe(false);
  });

  it('falls back to Referer when Origin is absent (LAN IP referer)', () => {
    const ok = isSameOriginRequest(
      `${LAN_ORIGIN}/api/security/payload-key`,
      'POST',
      headersWith({ referer: `${LAN_ORIGIN}/dashboard` }),
    );
    expect(ok).toBe(true);
  });

  it('rejects a referer from a different host in production', () => {
    const ok = isSameOriginRequest(
      `${LAN_ORIGIN}/api/security/payload-key`,
      'POST',
      headersWith({ referer: `${LOCAL_ORIGIN}/dashboard` }),
    );
    expect(ok).toBe(false);
  });

  it('skips validation for safe methods (GET) regardless of origin', () => {
    const ok = isSameOriginRequest(
      `${LAN_ORIGIN}/api/auth/user-permissions`,
      'GET',
      headersWith({}),
    );
    expect(ok).toBe(true);
  });

  it('rejects a state-changing request with no Origin/Referer in production (fail closed)', () => {
    const ok = isSameOriginRequest(
      `${LAN_ORIGIN}/api/security/payload-key`,
      'POST',
      headersWith({}),
    );
    expect(ok).toBe(false);
  });

  it('relaxes to allow curl/Postman (no Origin) in development', async () => {
    vi.resetModules();
    vi.doMock('@/lib/env', () => ({
      env: { NODE_ENV: 'development' },
    }));
    const { isSameOriginRequest: devCheck } = await import('@/lib/csrf');
    expect(
      devCheck(`${LAN_ORIGIN}/api/security/payload-key`, 'POST', headersWith({})),
    ).toBe(true);
  });

  it('ignores path/query differences — only origin identity matters', () => {
    const ok = isSameOriginRequest(
      `${LAN_ORIGIN}/api/security/payload-key?x=1`,
      'POST',
      headersWith({ origin: LAN_ORIGIN }),
    );
    expect(ok).toBe(true);
  });
});

describe('isSameSiteRequest (FRONTEND_URL-pinned legacy gate — unchanged contract)', () => {
  it('stays host-specific: a non-localhost Origin is rejected in production', async () => {
    vi.resetModules();
    vi.doMock('@/lib/env', () => ({
      env: { NODE_ENV: 'production', FRONTEND_URL: LOCAL_ORIGIN },
    }));
    const { isSameSiteRequest: prodCheck } = await import('@/lib/csrf');
    expect(
      prodCheck('POST', headersWith({ origin: LAN_ORIGIN })),
    ).toBe(false);
  });

  it('accepts the configured FRONTEND_URL origin in production', async () => {
    vi.resetModules();
    vi.doMock('@/lib/env', () => ({
      env: { NODE_ENV: 'production', FRONTEND_URL: LOCAL_ORIGIN },
    }));
    const { isSameSiteRequest: prodCheck } = await import('@/lib/csrf');
    expect(
      prodCheck('POST', headersWith({ origin: LOCAL_ORIGIN })),
    ).toBe(true);
  });
});
