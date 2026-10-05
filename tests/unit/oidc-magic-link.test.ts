/**
 * Unit tests for lib/oidc-magic-link.ts — invitation magic-link issue/consume.
 *
 * Hermetic: the Prisma client and the email seam are mocked. The helpers take
 * no globals, so every assertion is against the injected prisma mock (real
 * call shapes — verification.create/deleteMany/findUnique — which also keeps
 * any future signature drift honest).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { issueInviteLink, consumeInviteToken } from '@/lib/oidc-magic-link';
import type { User } from '@prisma/client';

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

describe('issueInviteLink', () => {
  beforeEach(() => vi.clearAllMocks());

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
    expect(String(subject)).toMatch(/activat|sign in/i);
    expect(String(message)).toContain(res.token);
    expect(String(message)).toContain('Flow Person');
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

    const res = await consumeInviteToken(token);

    expect(res.ok === true && res.email).toBe('flow.person@example.com');
    // claim is the delete, keyed on identifier AND future expiry (atomic single-use)
    expect(mockPrisma.verification.deleteMany).toHaveBeenCalledTimes(1);
    const args = mockPrisma.verification.deleteMany.mock.calls[0][0];
    expect(args.where.identifier).toBe(token);
    expect(args.where.expiresAt.gt.getTime()).toBeGreaterThanOrEqual(Date.now());
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
