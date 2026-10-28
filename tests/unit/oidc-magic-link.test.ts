/**
 * Unit tests for lib/oidc-magic-link.ts — invitation magic-link issue/consume.
 *
 * Hermetic: the Prisma client and the email seam are mocked. The helpers take
 * no globals, so every assertion is against the injected prisma mock (real
 * call shapes — verification.create/deleteMany/findUnique — which also keeps
 * any future signature drift honest).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockPrisma, mockSendEmail, mockLogger } = vi.hoisted(() => {
  const mockPrisma = {
    verification: {
      create: vi.fn(),
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  const mockSendEmail = vi.fn();
  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { mockPrisma, mockSendEmail, mockLogger };
});

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));
vi.mock('nodemailer', () => ({})); // isolate from transporter machinery
vi.mock('@/lib/notifications/email', () => ({ sendEmail: mockSendEmail }));
vi.mock('@/lib/logger', () => ({ logger: mockLogger }));

import os from 'os';
import { issueInviteLink, consumeInviteToken, normalizePortalOrigin, getMachineIPv4 } from '@/lib/oidc-magic-link';
import type { User } from '@prisma/client';

/** LAN IPv4 the fake machine exposes; stub per-test to exercise edge cases. */
function stubNetworkInterfaces(address: string | null) {
  const interfaces: Record<string, Array<{ address: string; family: 'IPv4'; internal: boolean }>> = {
    lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
  };
  if (address) interfaces.en0 = [{ address, family: 'IPv4', internal: false }];
  return vi.spyOn(os, 'networkInterfaces').mockReturnValue(interfaces as never);
}

function makeUser(overrides: Record<string, unknown> = {}): User & { oidcVerified?: boolean } {
  return {
    id: 'u-1',
    name: 'Flow Person',
    email: 'flow.person@example.com',
    emailVerified: true,
    image: null,
    passwordHash: null,
    role: 'member',
    banned: false,
    banReason: null,
    banExpires: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    activeOrganizationId: null,
    oidcVerified: false,
    ...overrides,
  } as User;
}

describe('getMachineIPv4', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the first non-internal IPv4 address', () => {
    stubNetworkInterfaces('172.16.0.9');
    expect(getMachineIPv4()).toBe('172.16.0.9');
  });

  it('skips loopback and IPv6 entries', () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      en0: [
        { address: 'fe80::abc', family: 'IPv6', internal: false },
        { address: '10.0.0.5', family: 'IPv4', internal: false },
      ],
    } as never);
    expect(getMachineIPv4()).toBe('10.0.0.5');
  });

  it('returns null when no usable IPv4 exists', () => {
    stubNetworkInterfaces(null);
    expect(getMachineIPv4()).toBeNull();
  });
});

describe('issueInviteLink', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('inserts a Verification row (identifier=token, kind oidc-invite, ~5min TTL) and returns url', async () => {
    mockPrisma.verification.create.mockResolvedValue({ id: 'v-1' });
    mockSendEmail.mockResolvedValue({ success: true });

    const res = await issueInviteLink(makeUser());

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.token.length).toBeGreaterThanOrEqual(32);
    expect(res.url).toContain('/auth/magic-link/verify?token=');
    expect(res.url.endsWith(res.token)).toBe(true);

    const { data } = mockPrisma.verification.create.mock.calls[0][0];
    expect(data.identifier).toBe(res.token);
    const value = JSON.parse(data.value as string);
    expect(value.kind).toBe('oidc-invite');
    expect(value.email).toBe('flow.person@example.com');
    // TTL: between 4 and 6 minutes out (tolerates clock jitter)
    const ttlMs = (data.expiresAt as Date).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(4 * 60 * 1000);
    expect(ttlMs).toBeLessThan(6 * 60 * 1000);
  });

  it('sends exactly one email with the user name, email and CTA url', async () => {
    mockPrisma.verification.create.mockResolvedValue({ id: 'v-1' });
    mockSendEmail.mockResolvedValue({ success: true });

    const res = await issueInviteLink(makeUser());
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const [to, subject, message] = mockSendEmail.mock.calls[0];
    expect(to).toBe('flow.person@example.com');
    // Subject is the literal product copy (NIPP account activation) — pin exact
    // wording so a reword doesn't slip past the /activat/i net.
    expect(String(subject)).toBe('NIPP account activation');
    expect(String(message)).toContain(res.token);
    expect(String(message)).toContain('Flow Person');
  });

  it('builds the link on the portalOrigin (LAN IP) — not a pinned FRONTEND_URL', async () => {
    mockPrisma.verification.create.mockResolvedValue({ id: 'v-lan' });
    mockSendEmail.mockResolvedValue({ success: true });

    const res = await issueInviteLink(makeUser(), { portalOrigin: 'http://192.168.2.8:3000' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Button href AND the fallback text both carry the reachable server IP.
    expect(res.url.startsWith('http://192.168.2.8:3000/auth/magic-link/verify?token=')).toBe(true);
    expect(res.url).not.toContain('localhost');
    const [to, _subject, message] = mockSendEmail.mock.calls[0];
    void to;
    // The URL appears twice (link + button href), both on the LAN origin.
    expect(String(message).split('http://192.168.2.8:3000/auth/magic-link/verify').length - 1).toBeGreaterThanOrEqual(2);
  });

  it('resolves a loopback portalOrigin (admin in their own browser) to the machine LAN IPv4', async () => {
    stubNetworkInterfaces('192.168.2.2');
    mockPrisma.verification.create.mockResolvedValue({ id: 'v-lb' });
    mockSendEmail.mockResolvedValue({ success: true });

    const res = await issueInviteLink(makeUser(), { portalOrigin: 'http://localhost:3000' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // The invited user must reach the server on its LAN address + request port.
    expect(res.url.startsWith('http://192.168.2.2:3000/auth/magic-link/verify?token=')).toBe(true);
    // Neither host form of loopback may leak into the email body.
    const [, _subject, message] = mockSendEmail.mock.calls[0];
    void _subject;
    expect(String(message)).not.toContain('localhost');
    expect(String(message)).not.toContain('127.0.0.1');
  });

  it('keeps the request port when resolving loopback (non-3000 dev servers too)', async () => {
    stubNetworkInterfaces('192.168.2.2');
    mockPrisma.verification.create.mockResolvedValue({ id: 'v-port' });
    mockSendEmail.mockResolvedValue({ success: true });

    const res = await issueInviteLink(makeUser(), { portalOrigin: 'http://127.0.0.1:3001' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.url.startsWith('http://192.168.2.2:3001/auth/magic-link/verify?token=')).toBe(true);
  });

  it('falls back to FRONTEND_URL for a loopback origin when the machine has no LAN IPv4', async () => {
    stubNetworkInterfaces(null);
    mockPrisma.verification.create.mockResolvedValue({ id: 'v-nolans' });
    mockSendEmail.mockResolvedValue({ success: true });

    const res = await issueInviteLink(makeUser(), { portalOrigin: 'http://localhost:3000' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Fail closed — a pinned (if dead) origin beats an unparseable URL.
    expect(res.url.startsWith('http://localhost:3000/auth/magic-link/verify?token=')).toBe(true);
  });

  it('drops a trailing slash from portalOrigin and keeps the token in the URL', async () => {
    mockPrisma.verification.create.mockResolvedValue({ id: 'v-slash' });
    mockSendEmail.mockResolvedValue({ success: true });

    const res = await issueInviteLink(makeUser(), { portalOrigin: 'https://portal.example.com/' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.url).toBe(`https://portal.example.com/auth/magic-link/verify?token=${res.token}`);
  });

  it('falls back to FRONTEND_URL when portalOrigin is malformed (never emits an unparseable URL)', async () => {
    mockPrisma.verification.create.mockResolvedValue({ id: 'v-bad' });
    mockSendEmail.mockResolvedValue({ success: true });

    for (const bad of ['not a url', '/', '', null]) {
      const res = await issueInviteLink(makeUser(), { portalOrigin: bad });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.url.startsWith('http://localhost:3000/auth/magic-link/verify?token=')).toBe(true);
    }
  });

  describe('normalizePortalOrigin', () => {
    it('accepts full URLs, bare origins, strips trailing slashes', () => {
      expect(normalizePortalOrigin('http://192.168.2.8:3000')).toBe('http://192.168.2.8:3000');
      expect(normalizePortalOrigin('https://portal.example.com/')).toBe('https://portal.example.com');
      // Full URL collapses to origin (path/query stripped).
      expect(normalizePortalOrigin('https://portal.example.com/some/path?x=1')).toBe('https://portal.example.com');
    });

    it('rejects garbage, bare paths, and empty input', () => {
      expect(normalizePortalOrigin(null)).toBeNull();
      expect(normalizePortalOrigin(undefined)).toBeNull();
      expect(normalizePortalOrigin('not a url')).toBeNull();
      expect(normalizePortalOrigin('/just/a/path')).toBeNull();
    });
  });

  it('issues unique tokens per call', async () => {
    mockPrisma.verification.create.mockResolvedValue({ id: 'v-x' });
    mockSendEmail.mockResolvedValue({ success: true });

    const a = await issueInviteLink(makeUser());
    const b = await issueInviteLink(makeUser());
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.token).not.toBe(b.token);
  });

  it('resolves OK even when the SMTP seam fails (link is consumable; admin can resend)', async () => {
    mockPrisma.verification.create.mockResolvedValue({ id: 'v-1' });
    mockSendEmail.mockRejectedValue(new Error('smtp down'));

    const res = await issueInviteLink(makeUser());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // failure is logged, not thrown
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('returns { ok: false } when the Verification insert fails', async () => {
    mockPrisma.verification.create.mockRejectedValue(new Error('db down'));
    const res = await issueInviteLink(makeUser());
    expect(res.ok).toBe(false);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});

describe('consumeInviteToken', () => {
  beforeEach(() => vi.clearAllMocks());

  it('consumes an unexpired token: returns email, row deleted atomically', async () => {
    const token = 'tok-consume-1';
    mockPrisma.verification.findFirst.mockResolvedValue({
      id: 'v-2',
      identifier: token,
      value: JSON.stringify({ email: 'flow.person@example.com', kind: 'oidc-invite' }),
      expiresAt: new Date(Date.now() + 60_000),
    });
    mockPrisma.verification.deleteMany.mockResolvedValue({ count: 1 });

    // Baseline captured BEFORE the call: consumeInviteToken snapshots `now`
    // internally, so asserting against a later Date.now() is a clock race on
    // slow machines (CI). The delete's expiresAt.gt must be >= this baseline.
    const before = Date.now();
    const res = await consumeInviteToken(token);

    expect(res.ok === true && res.email).toBe('flow.person@example.com');
    // claim is the delete, keyed on identifier AND future expiry (atomic single-use)
    expect(mockPrisma.verification.deleteMany).toHaveBeenCalledTimes(1);
    const args = mockPrisma.verification.deleteMany.mock.calls[0][0];
    expect(args.where.identifier).toBe(token);
    expect(args.where.expiresAt.gt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('unknown token → invalid, no delete attempt', async () => {
    mockPrisma.verification.findFirst.mockResolvedValue(null);
    const res = await consumeInviteToken('never-existed');
    expect(res).toMatchObject({ ok: false, reason: 'invalid' });
    expect(mockPrisma.verification.deleteMany).not.toHaveBeenCalled();
  });

  it('expired token → reason expired (row untouched)', async () => {
    mockPrisma.verification.findFirst.mockResolvedValue({
      id: 'v-3',
      identifier: 'tok-expired',
      value: JSON.stringify({ email: 'x@y.z', kind: 'oidc-invite' }),
      expiresAt: new Date(Date.now() - 1_000),
    });
    const res = await consumeInviteToken('tok-expired');
    expect(res).toMatchObject({ ok: false, reason: 'expired' });
    expect(mockPrisma.verification.deleteMany).not.toHaveBeenCalled();
  });

  it('value JSON without email → invalid (defensive; we always write it)', async () => {
    mockPrisma.verification.findFirst.mockResolvedValue({
      id: 'v-4',
      identifier: 'tok-badval',
      value: JSON.stringify({ kind: 'oidc-invite' }),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const res = await consumeInviteToken('tok-badval');
    expect(res.ok).toBe(false);
    expect(mockPrisma.verification.deleteMany).not.toHaveBeenCalled();
  });
});
