/**
 * Unit tests: /login banner classification for the Google-OIDC
 * pre-registration flow (Phase 3, Task 7). Pins that the ban-banner detector
 * does NOT swallow the two new provisioning-gate messages, and that the
 * callbackUrl guard only accepts same-origin relative paths.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyGateMessage,
  oidcParamBanner,
  resolveSameOriginTarget,
  OIDC_LINK_VERIFIED_TEXT,
  OIDC_LINK_FAILED_TEXT,
} from '@/lib/oidc-login-ui';

// Mirrors the exact messages thrown by enforceOidcProvisioning in lib/auth.ts.
const INBOX_CHECK_MSG =
  'Access denied. We need to confirm your email first — check your inbox for a verification link, then try signing in with Google again.';
const NOT_PROVISIONED_MSG =
  'Access denied. This account has not been provisioned by an administrator yet. Contact your portal administrator.';

describe('classifyGateMessage', () => {
  it('classifies the unverified-inbox gate message as needs-inbox-check (NOT banned)', () => {
    expect(classifyGateMessage(INBOX_CHECK_MSG)).toBe('needs-inbox-check');
  });

  it('classifies the not-provisioned gate message distinctly', () => {
    expect(classifyGateMessage(NOT_PROVISIONED_MSG)).toBe('not-provisioned');
  });

  it('keeps genuine ban messages classified as banned', () => {
    expect(classifyGateMessage('Access denied. Your account has been banned.')).toBe('banned');
    expect(classifyGateMessage('Banned for abuse by admin')).toBe('banned');
  });

  it('returns null for ordinary sign-in errors', () => {
    expect(classifyGateMessage('Invalid credentials')).toBeNull();
    expect(classifyGateMessage('Google sign-in failed. Try again or use your password.')).toBeNull();
    expect(classifyGateMessage('')).toBeNull();
  });
});

describe('oidcParamBanner', () => {
  it('renders the success banner for link-verified', () => {
    expect(oidcParamBanner('link-verified')).toEqual({ tone: 'success', text: OIDC_LINK_VERIFIED_TEXT });
  });

  it('renders the info banner for link-expired', () => {
    expect(oidcParamBanner('link-expired')).toEqual({ tone: 'info', text: OIDC_LINK_FAILED_TEXT });
  });

  it('treats unknown values (e.g. legacy inbox-check) as the info banner', () => {
    const banner = oidcParamBanner('inbox-check');
    expect(banner?.tone).toBe('info');
    expect(banner?.text).toBe(OIDC_LINK_FAILED_TEXT);
  });

  it('returns null when the param is absent', () => {
    expect(oidcParamBanner(null)).toBeNull();
    expect(oidcParamBanner('')).toBeNull();
  });
});

describe('resolveSameOriginTarget', () => {
  const origin = 'http://localhost:3000';

  it('accepts relative paths from the portal', () => {
    expect(resolveSameOriginTarget('/dashboard', origin)).toBe('/dashboard');
    expect(resolveSameOriginTarget('/', origin)).toBe('/');
    expect(resolveSameOriginTarget('/dashboard?x=1', origin)).toBe('/dashboard?x=1');
  });

  it('rejects absolute forms (even same-origin) — only relative paths ship', () => {
    expect(resolveSameOriginTarget('http://localhost:3000/dashboard', origin)).toBe('/');
  });

  it('rejects cross-origin and protocol-relative targets', () => {
    expect(resolveSameOriginTarget('https://evil.example/x', origin)).toBe('/');
    expect(resolveSameOriginTarget('//evil.example/x', origin)).toBe('/');
  });

  it('falls back to home for null/unparseable input', () => {
    expect(resolveSameOriginTarget(null, origin)).toBe('/');
  });
});
