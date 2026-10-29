/**
 * Unit tests for lib/forgot-password.ts — Phase 1 scaffold (Task 1.1).
 *
 * Covers the two pieces landed in this task:
 *   - `maskEmail`           — PII masking convention for audit/metadata writes (design §9 T8 / §13 Q5).
 *   - `PASSWORD_RESET_TOKEN_TTL_SECS` — reset token lifetime (seconds), env-overridable.
 *
 * TTL is read per-module-load (env snapshot), so each test re-imports fresh via
 * `vi.resetModules()` + dynamic import after stubbing env.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

async function loadForgotPassword() {
  const mod = await import('@/lib/forgot-password');
  return mod;
}

describe('maskEmail', () => {
  it('masks the local part after the first char, keeps domain', async () => {
    const { maskEmail } = await loadForgotPassword();
    expect(maskEmail('john@example.com')).toBe('j***@example.com');
  });

  it('handles a one-char local part', async () => {
    const { maskEmail } = await loadForgotPassword();
    expect(maskEmail('a@x.co')).toBe('a***@x.co');
  });
});

describe('token TTL config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('defaults to 3600', async () => {
    const { PASSWORD_RESET_TOKEN_TTL_SECS } = await loadForgotPassword();
    expect(PASSWORD_RESET_TOKEN_TTL_SECS).toBe(3600);
  });

  it('reads PASSWORD_RESET_TOKEN_TTL_SECS from env when set', async () => {
    vi.stubEnv('PASSWORD_RESET_TOKEN_TTL_SECS', '600');
    const { PASSWORD_RESET_TOKEN_TTL_SECS } = await loadForgotPassword();
    expect(PASSWORD_RESET_TOKEN_TTL_SECS).toBe(600);
  });

  it('defaults to a sane minimum (> 300s) when env is unset', async () => {
    const { PASSWORD_RESET_TOKEN_TTL_SECS } = await loadForgotPassword();
    expect(PASSWORD_RESET_TOKEN_TTL_SECS).toBeGreaterThan(300);
  });
});