/**
 * Unit tests for lib/forgot-password.ts (Phase 1, plan 2026-10-29).
 *
 * Hermetic: the send seam is injected per-test; env/logger/nodemailer/db are
 * mocked so no real SMTP call or DB query can happen. Mirrors the mock shape
 * of tests/unit/oidc-magic-link.test.ts (same seams, same conventions).
 *
 * Covers:
 *   - `maskEmail`                  — PII masking convention (design §9 T8 / §13 Q5).
 *   - `PASSWORD_RESET_TOKEN_TTL_SECS` — reset token lifetime (seconds), env-overridable.
 *   - `resolveResetLinkOrigin`     — host-independent link base (delegates to
 *                                    oidc-magic-link's resolveLinkBase semantics).
 *   - `issueResetEmail`            — branded reset email, never throws, reports
 *                                    delivery via { emailSent }.
 *
 * TTL is read per-module-load (env snapshot), so those tests re-import fresh via
 * `vi.resetModules()` + dynamic import after stubbing env.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockPrisma, mockSendEmail, mockLogger } = vi.hoisted(() => ({
  mockPrisma: {
    // Index map — tests attach the specific model methods they exercise per-block.
    verification: {} as Record<string, unknown>,
    account: { findMany: vi.fn() },
    user: {} as Record<string, unknown>,
  },
  mockSendEmail: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('nodemailer', () => ({})); // isolate from transporter machinery
vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/env', () => ({ env: { FRONTEND_URL: 'http://localhost:3000' } }));
vi.mock('@/lib/logger', () => ({ logger: mockLogger }));
// Unit tests exercise route logic against mocked prisma — pass the op straight
// through. The verified-RLS wrapper itself is covered by rls-transaction.test.ts
// (same convention as tenant-mgmt-* / org-status-ban tests).
vi.mock('@/lib/platform-db', () => ({
  withPlatformContext: vi.fn(async (_userId: string, fn: () => Promise<unknown>) => fn()),
}));
vi.mock('@/lib/notifications/email', () => ({
  sendEmail: mockSendEmail,
  // Pure function — replicate the real implementation so escaping is exercised
  // for real (the production module exports the same 4-replacement chain).
  escapeHtml: (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;'),
}));

import os from 'os';
import { issueResetEmail, resolveResetLinkOrigin, hasCredentialAccount, AUDIT_ACTION } from '@/lib/forgot-password';

/** LAN IPv4 the fake machine exposes; stub per-test for loopback resolution. */
function stubNetworkInterfaces(address: string | null) {
  const interfaces: Record<string, Array<{ address: string; family: 'IPv4'; internal: boolean }>> = {
    lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
  };
  if (address) interfaces.en0 = [{ address, family: 'IPv4', internal: false }];
  return vi.spyOn(os, 'networkInterfaces').mockReturnValue(interfaces as never);
}

/** Records calls to the injected send seam for assertions. */
function makeRecorder() {
  const sent: Array<{ to: string; subject: string; message: string }> = [];
  const sendFn = async (to: string, subject: string, message: string) => {
    sent.push({ to, subject, message });
    return { success: true } as { success: boolean; error?: unknown };
  };
  return { sent, sendFn };
}

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

  it('returns *** for input without an @', async () => {
    const { maskEmail } = await loadForgotPassword();
    expect(maskEmail('not-an-email')).toBe('***');
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

describe('resolveResetLinkOrigin', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses an explicit non-loopback portal origin, stripping trailing slashes and paths', () => {
    expect(resolveResetLinkOrigin('http://192.168.0.5:3000/')).toBe('http://192.168.0.5:3000');
    expect(resolveResetLinkOrigin('https://portal.example.com/some/path?x=1')).toBe(
      'https://portal.example.com',
    );
  });

  it('resolves a loopback origin to the machine LAN IPv4 + request port', () => {
    stubNetworkInterfaces('192.168.2.2');
    expect(resolveResetLinkOrigin('http://localhost:3000')).toBe('http://192.168.2.2:3000');
    expect(resolveResetLinkOrigin('http://127.0.0.1:3001')).toBe('http://192.168.2.2:3001');
  });

  it('falls back to FRONTEND_URL for null/malformed origins (fail closed, never unparseable)', () => {
    stubNetworkInterfaces(null);
    expect(resolveResetLinkOrigin(null)).toBe('http://localhost:3000');
    expect(resolveResetLinkOrigin(undefined)).toBe('http://localhost:3000');
    expect(resolveResetLinkOrigin('not a url')).toBe('http://localhost:3000');
  });
});

describe('issueResetEmail', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  const user = { id: 'u1', email: 'JOHN@Example.com', name: '' };

  it('builds the link on the given portal origin, lower-cases the recipient, no double slash', async () => {
    const { sent, sendFn } = makeRecorder();
    const res = await issueResetEmail(user, 'tok123', {
      portalOrigin: 'http://192.168.0.5:3000/',
      sendFn,
    });

    expect(res.emailSent).toBe(true);
    expect(sent[0].to).toBe('john@example.com');
    expect(sent[0].subject).toBe('Property NI — Reset your password');
    expect(sent[0].message).toContain('/auth/reset-password?token=tok123');
    expect(sent[0].message).not.toContain('//auth/'); // trailing slash stripped from origin
    expect(sent[0].message).not.toContain('<script');
  });

  it('greets with the email local part when the name is empty', async () => {
    const { sent, sendFn } = makeRecorder();
    await issueResetEmail(user, 't1', { portalOrigin: 'http://lan-host:3000', sendFn });
    expect(sent[0].message).toContain('Hi john,');
  });

  it('greets with the local part when the name is BetterAuth\u2019s default "User"', async () => {
    const { sent, sendFn } = makeRecorder();
    await issueResetEmail({ id: 'u2', email: 'mary@Example.com', name: 'User' }, 't2', { sendFn });
    expect(sent[0].message).toContain('Hi mary,');
  });

  it('html-escapes the greeting (no tag injection through the name field)', async () => {
    const { sent, sendFn } = makeRecorder();
    await issueResetEmail(
      { id: 'u3', email: 'x@example.com', name: 'Evil<script>alert(1)</script>' },
      't3',
      { sendFn },
    );
    expect(sent[0].message).not.toContain('<script');
    expect(sent[0].message).toContain('&lt;script&gt;');
  });

  it('resolves a loopback portalOrigin to the machine LAN IPv4 (reachable link)', async () => {
    stubNetworkInterfaces('192.168.2.2');
    const { sent, sendFn } = makeRecorder();
    await issueResetEmail(user, 't4', { portalOrigin: 'http://localhost:3000', sendFn });
    expect(sent[0].message).toContain('http://192.168.2.2:3000/auth/reset-password?token=t4');
    expect(sent[0].message).not.toContain('localhost');
  });

  it('states the expiry in minutes derived from the TTL constant', async () => {
    const { sent, sendFn } = makeRecorder();
    await issueResetEmail(user, 't5', { sendFn });
    expect(sent[0].message).toContain('expires in 60 minutes');
  });

  it('reports emailSent=false when the SMTP seam reports failure (no throw, token stays valid)', async () => {
    const res = await issueResetEmail(user, 't6', {
      portalOrigin: null,
      sendFn: async () => ({ success: false, error: 'boom' }),
    });
    expect(res.emailSent).toBe(false);
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('reports emailSent=false and does not throw when the SMTP seam raises', async () => {
    const res = await issueResetEmail(user, 't7', {
      sendFn: async () => {
        throw new Error('smtp down');
      },
    });
    expect(res.emailSent).toBe(false);
    expect(mockLogger.error).toHaveBeenCalled();
  });
});

describe('hasCredentialAccount', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns true when a credential Account row exists (local user, incl. dual-door)', async () => {
    mockPrisma.account.findMany.mockResolvedValue([
      { providerId: 'credential' },
      { providerId: 'google' },
    ]);
    await expect(hasCredentialAccount('u1')).resolves.toBe(true);
    // The read is scoped to the exact userId passed in.
    expect(mockPrisma.account.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      select: { providerId: true },
    });
  });

  it('returns false for an OIDC-only account (google row, no credential)', async () => {
    mockPrisma.account.findMany.mockResolvedValue([{ providerId: 'google' }]);
    await expect(hasCredentialAccount('u1')).resolves.toBe(false);
  });

  it('returns false for a user with no Account rows at all', async () => {
    mockPrisma.account.findMany.mockResolvedValue([]);
    await expect(hasCredentialAccount('u1')).resolves.toBe(false);
  });
});

describe('resetTokenOwnerEmail', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the owner email from a prisma.user.findUnique scoped to the userId', async () => {
    mockPrisma.user = { findUnique: vi.fn().mockResolvedValue({ email: 'owner@propni.example.com' }) } as never;
    const res = await import('@/lib/forgot-password').then((m) => m.resetTokenOwnerEmail('u-9'));
    expect(res).toBe('owner@propni.example.com');
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'u-9' }, select: { email: true } });
  });

  it('returns null when the owner row is gone (route answers invalid-link)', async () => {
    mockPrisma.user = { findUnique: vi.fn().mockResolvedValue(null) } as never;
    const res = await import('@/lib/forgot-password').then((m) => m.resetTokenOwnerEmail('ghost'));
    expect(res).toBeNull();
  });
});

describe('AUDIT_ACTION constants (DRY — Phase 3 routes import, never inline)', () => {
  it('exposes the three design §7 action names verbatim', () => {
    expect(AUDIT_ACTION.PASSWORD_RESET_REQUESTED).toBe('user.password-reset-requested');
    expect(AUDIT_ACTION.PASSWORD_RESET_LINK_OPENED).toBe('user.password-reset-link-opened');
    expect(AUDIT_ACTION.PASSWORD_RESET_SUCCESS).toBe('user.password-reset-success');
  });
});

describe('preFlightResetToken (read-only token check for verify/reset routes)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves the row when a non-expired reset-password:<token> exists', async () => {
    mockPrisma.verification.findFirst = vi.fn().mockResolvedValue({
      identifier: 'reset-password:tok123',
      value: 'u-reset-1',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const res = await import('@/lib/forgot-password').then((m) => m.preFlightResetToken('tok123'));
    expect(res).toEqual({ userId: 'u-reset-1', expiresAt: expect.any(Date) });
    expect(mockPrisma.verification.findFirst).toHaveBeenCalledWith({
      where: { identifier: 'reset-password:tok123' },
    });
  });

  it('returns null for a missing token, WITHOUT deleting anything', async () => {
    mockPrisma.verification.findFirst = vi.fn().mockResolvedValue(null);
    mockPrisma.verification.deleteMany = vi.fn();
    const res = await import('@/lib/forgot-password').then((m) => m.preFlightResetToken('gone'));
    expect(res).toBeNull();
    // READ-ONLY contract: no delete may happen here — consumption belongs to
    // BetterAuth's consumeVerificationValue at reset time.
    expect(mockPrisma.verification.deleteMany).not.toHaveBeenCalled();
  });

  it('returns null (reason expired) for a past expiresAt', async () => {
    mockPrisma.verification.findFirst = vi.fn().mockResolvedValue({
      identifier: 'reset-password:tok123',
      value: 'u-reset-1',
      expiresAt: new Date(Date.now() - 1000),
    });
    const res = await import('@/lib/forgot-password').then((m) => m.preFlightResetToken('tok123'));
    expect(res).toBeNull();
  });

  it('returns null for a token whose identifier shape is not reset-password (no delete)', async () => {
    mockPrisma.verification.findFirst = vi.fn().mockResolvedValue(null); // nothing under this exact identifier
    const res = await import('@/lib/forgot-password').then((m) => m.preFlightResetToken('some-oidc-invite-token'));
    expect(res).toBeNull();
    expect(mockPrisma.verification.findFirst).toHaveBeenCalledWith({
      where: { identifier: 'reset-password:some-oidc-invite-token' },
    });
  });
});
