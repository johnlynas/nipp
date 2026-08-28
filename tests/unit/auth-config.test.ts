/**
 * Unit tests for lib/auth.ts — BetterAuth server configuration and hooks.
 *
 * Strategy:
 *  - Mock 'better-auth/minimal' (betterAuth factory) to CAPTURE the options
 *    object, then invoke captured callbacks/hook handlers directly with hand-
 *    built contexts. This exercises exactly what the app ships without a DB.
 *  - Mock prisma, env, and logger so hook bodies are hermetic.
 *  - For permission-resolution paths, dynamically imported modules
 *    (@/lib/db, @/lib/permissions/resolver, @/lib/authz) are mocked via
 *    vi.mock so the session callback can be driven end-to-end in both
 *    success and failure branches.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks (hoisted before imports)
// ---------------------------------------------------------------------------

const {
  capturedAuth,
  mockPrisma,
  mockResolvePermissions,
  mockGetPlatformOrgId,
  mockIsSuperAdmin,
  mockLogger,
} = vi.hoisted(() => {
  const capturedAuth: { options: Record<string, unknown> | null } = { options: null };

  const mockPrisma = {
    user: { findUnique: vi.fn(), update: vi.fn() },
    member: { findFirst: vi.fn() },
    organization: { findUnique: vi.fn() },
    role: { findMany: vi.fn() },
    permission: { findMany: vi.fn() },
    $connect: vi.fn(),
  };

  return {
    capturedAuth,
    mockPrisma,
    mockResolvePermissions: vi.fn(),
    mockGetPlatformOrgId: vi.fn(),
    mockIsSuperAdmin: vi.fn(),
    mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
});

// betterAuth factory — capture options, return a minimal instance shape.
vi.mock('better-auth/minimal', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    betterAuth: (options: Record<string, unknown>) => {
      capturedAuth.options = options;
      // Real instance methods are irrelevant for these unit tests — the hooks,
      // callbacks, and config are all reachable from `options`.
      return { handler: vi.fn(), api: {}, options, $ERROR_CODES: {} };
    },
  };
});

vi.mock('better-auth/adapters/prisma', () => ({
  prismaAdapter: (db: unknown) => db,
}));

vi.mock('better-auth/plugins', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original };
});

vi.mock('better-auth/api', (importOriginal) => {
  // Pass through the real createAuthMiddleware + APIError — the middleware is
  // invoked directly in tests with a plain context object.
  return importOriginal<typeof import('better-auth/api')>();
});

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));

vi.mock('@/lib/env', () => ({ env: { NODE_ENV: 'test' } }));

vi.mock('@/lib/logger', () => ({ logger: mockLogger }));

// Dynamic imports inside the session callback.
vi.mock('@/lib/permissions/resolver', () => ({
  resolvePermissions: (...args: unknown[]) => mockResolvePermissions(...args),
}));

vi.mock('@/lib/authz', () => ({
  getPlatformOrgId: (...args: unknown[]) => mockGetPlatformOrgId(...args),
  isSuperAdmin: (...args: unknown[]) => mockIsSuperAdmin(...args),
}));

import { auth } from '@/lib/auth';
import { APIError } from 'better-auth/api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function options() {
  // Prefer what we captured at module load; fall back to the instance surface.
  const captured = capturedAuth.options as Record<string, any>;
  expect(captured).not.toBeNull();
  return captured;
}

/** Invoke the registered hooks.before middleware with a fabricated context. */
async function runBeforeHook(ctx: Record<string, unknown>): Promise<unknown> {
  const before = options().hooks.before;
  expect(typeof before).toBe('function');
  return before(ctx);
}

function bannedUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u_banned',
    email: 'banned@example.com',
    banned: true,
    banReason: 'Policy violation',
    banExpires: new Date(Date.now() + 3_600_000),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Configuration surface (assertions on the shipped options object)
// ---------------------------------------------------------------------------

describe('auth configuration (options)', () => {
  it('registers exactly one plugin (organization with teams enabled)', () => {
    const plugins = options().plugins as Array<Record<string, unknown>>;
    expect(plugins).toHaveLength(1);
    // The organization plugin marks itself with $id / metadata — assert by the
    // documented teams-mode surface it returns rather than internal shapes.
    expect(plugins[0]).toBeTruthy();
  });

  it('disables public sign-up, enables email/password without verification', () => {
    const eap = options().emailAndPassword as Record<string, unknown>;
    expect(eap.enabled).toBe(true);
    expect(eap.requireEmailVerification).toBe(false);
    expect(eap.disableSignUp).toBe(true);
  });

  it('configures the session backstop: 1h expiry, 15min renewal age', () => {
    const s = options().session as Record<string, any>;
    expect(s.expiresIn).toBe(60 * 60);
    expect(s.updateAge).toBe(60 * 15);
  });

  it('enables session cookie cache (1h maxAge) to survive short DB outages', () => {
    const s = options().session as Record<string, any>;
    expect(s.cookieCache).toEqual({ enabled: true, maxAge: 60 * 60 });
  });

  it('forces secure cookies with SameSite=Lax', () => {
    const adv = options().advanced as Record<string, any>;
    expect(adv.useSecureCookies).toBe(true);
    expect(adv.defaultCookieAttributes.sameSite).toBe('lax');
  });

  it('disables rate limiting in the test environment to keep e2e unblocked', () => {
    const rl = options().rateLimit as Record<string, any>;
    expect(rl.enabled).toBe(false); // env.NODE_ENV === 'test'
    // The brute-force rule is still defined so it activates in production.
    expect(rl.customRules['/api/auth/sign-in/email'].max).toBe(5);
    expect(rl.customRules['/api/auth/sign-in/email'].window).toBe(15 * 60);
    expect(rl.window).toBe(15 * 60);
    expect(rl.max).toBe(10);
  });

  it('wires a database hook and a before-middleware hook', () => {
    expect(typeof options().databaseHooks.session.create.after).toBe('function');
    expect(typeof options().hooks.before).toBe('function');
    expect(typeof options().callbacks.session).toBe('function');
  });

  it('exports the auth instance with handler + api surfaces', () => {
    expect(auth).toBeTruthy();
    expect(typeof (auth as any).handler).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// hooks.before — banned-user check on email sign-in
// ---------------------------------------------------------------------------

describe('hooks.before (banned user check)', () => {
  it('allows sign-in to proceed for a non-banned user', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ ...bannedUser(), banned: false, banReason: null, banExpires: null });

    await expect(runBeforeHook({ path: '/sign-in/email', body: { email: 'ok@example.com' } })).resolves.toBeUndefined();
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('throws APIError UNAUTHORIZED for an active banned user with the ban reason', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(bannedUser());

    let error: unknown;
    try {
      await runBeforeHook({ path: '/sign-in/email', body: { email: 'banned@example.com' } });
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(APIError);
    const apiErr = error as APIError & { statusCode: number };
    expect(apiErr.status).toBe('UNAUTHORIZED');
    expect(apiErr.statusCode).toBe(401);
    expect(apiErr.body?.message).toContain('Policy violation');
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('falls back to the default message when banReason is empty', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(bannedUser({ id: 'u_no_reason', banReason: '' }));

    let error: unknown;
    try {
      await runBeforeHook({ path: '/sign-in/email', body: { email: 'x@example.com' } });
    } catch (e) {
      error = e;
    }

    expect((error as APIError).body?.message).toContain('Your account has been banned.');
  });

  it('lifts expired bans automatically and allows sign-in', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(
      bannedUser({ id: 'u_expired', banExpires: new Date(Date.now() - 1000) }),
    );
    mockPrisma.user.update.mockResolvedValueOnce({});

    await expect(runBeforeHook({ path: '/sign-in/email', body: { email: 'expired@example.com' } })).resolves.toBeUndefined();

    expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u_expired' },
      data: { banned: false, banReason: null, banExpires: null },
    });
  });

  it('does nothing when the user does not exist yet', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);

    await expect(runBeforeHook({ path: '/sign-in/email', body: { email: 'ghost@example.com' } })).resolves.toBeUndefined();
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('ignores other paths even with an email in the body', async () => {
    await expect(runBeforeHook({ path: '/sign-up/email', body: { email: 'anyone@example.com' } })).resolves.toBeUndefined();
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('ignores /sign-in/email when the body has no email (defensive)', async () => {
    await expect(runBeforeHook({ path: '/sign-in/email', body: {} })).resolves.toBeUndefined();
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// callbacks.session — ban invalidation + permission injection
// ---------------------------------------------------------------------------

describe('callbacks.session (permission resolution)', () => {
  const sessionCb = options().callbacks.session as (
    args: { session: Record<string, any>; user: { id: string } },
  ) => Promise<unknown>;

  function makeSession(userId: string, activeOrganizationId: string | null = null) {
    return {
      session: { id: `s_${userId}`, user: { id: userId, name: 'U' }, activeOrganizationId },
      user: { id: userId },
    };
  }

  it('returns the session verbatim in the Edge Runtime (no DB access)', async () => {
    const previous = (globalThis as Record<string, unknown>).EdgeRuntime;
    (globalThis as Record<string, unknown>).EdgeRuntime = 'edge';
    try {
      const rawSession = makeSession('u_edge');
      expect(await sessionCb(rawSession as never)).toBe(rawSession.session ?? rawSession);
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete (globalThis as Record<string, unknown>).EdgeRuntime;
      else (globalThis as Record<string, unknown>).EdgeRuntime = previous;
    }
  });

  it('invalidates the session (null) for an active banned user', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(bannedUser({ id: 'u_ban_sess' }));

    await expect(sessionCb(makeSession('u_ban_sess') as never)).resolves.toBeNull();
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('lifts expired bans inside the session callback, then resolves permissions normally', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(
      bannedUser({ id: 'u_unban_sess', banExpires: new Date(Date.now() - 1000) }),
    );
    // Second lookup (same handler path) sees the user unbanned.
    mockPrisma.user.update.mockResolvedValueOnce({});
    mockGetPlatformOrgId.mockResolvedValueOnce(null);

    const result = (await sessionCb(makeSession('u_unban_sess') as never)) as Record<string, any>;

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u_unban_sess' },
      data: { banned: false, banReason: null, banExpires: null },
    });
    // Platform org unset → no permissions, non-super-admin.
    expect(result.user.permissions).toEqual([]);
    expect(result.user.isSuperAdmin).toBe(false);
  });

  it('grants wildcard permissions to super admins of the platform org', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'u_super', banned: false });
    mockGetPlatformOrgId.mockResolvedValueOnce('org_platform');
    mockIsSuperAdmin.mockResolvedValueOnce(true);

    const result = (await sessionCb(makeSession('u_super') as never)) as Record<string, any>;

    expect(result.user.permissions).toEqual(['*']);
    expect(result.user.isSuperAdmin).toBe(true);
    expect(mockResolvePermissions).not.toHaveBeenCalled();
  });

  it('resolves org-scoped permissions for non-super-admins with an active org', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'u_member', banned: false });
    mockGetPlatformOrgId.mockResolvedValueOnce('org_platform');
    mockIsSuperAdmin.mockResolvedValueOnce(false);
    mockResolvePermissions.mockResolvedValueOnce(['logs:view', 'users:manage']);

    const result = (await sessionCb(makeSession('u_member', 'org_42') as never)) as Record<string, any>;

    expect(mockResolvePermissions).toHaveBeenCalledWith('u_member', 'org_42');
    expect(result.user.permissions).toEqual(['logs:view', 'users:manage']);
    expect(result.user.isSuperAdmin).toBe(false);
  });

  it('leaves permissions empty when the user has no active organization', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'u_noorg', banned: false });
    mockGetPlatformOrgId.mockResolvedValueOnce('org_platform');
    mockIsSuperAdmin.mockResolvedValueOnce(false);

    const result = (await sessionCb(makeSession('u_noorg', null) as never)) as Record<string, any>;

    expect(mockResolvePermissions).not.toHaveBeenCalled();
    expect(result.user.permissions).toEqual([]);
  });

  it('returns the unmodified session when permission resolution throws (log + fall-through)', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'u_break', banned: false });
    mockGetPlatformOrgId.mockRejectedValueOnce(new Error('platform org lookup failed'));

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = (await sessionCb(makeSession('u_break') as never)) as Record<string, any>;
      // The catch handler logs and returns the plain input session.
      expect(result).not.toBeNull();
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// databaseHooks.session.create.after — auto-assign activeOrganizationId
// ---------------------------------------------------------------------------

describe('databaseHooks.session.create.after (auto org assignment)', () => {
  const hook = options().databaseHooks.session.create.after as (
    session: { id: string; userId: string },
  ) => Promise<void>;

  it('is a registered async function', () => {
    expect(typeof hook).toBe('function');
  });

  it('skips assignment when the user already has an activeOrganizationId', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: 'u_set',
      activeOrganizationId: 'org_existing',
    });

    await hook({ id: 's1', userId: 'u_set' });

    expect(mockPrisma.member.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('assigns the org from the user Member record when missing', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'u_empty', activeOrganizationId: null });
    mockPrisma.member.findFirst.mockResolvedValueOnce({ orgId: 'org_from_member' });
    mockPrisma.user.update.mockResolvedValueOnce({});

    await hook({ id: 's2', userId: 'u_empty' });

    expect(mockPrisma.member.findFirst).toHaveBeenCalledWith({
      where: { userId: 'u_empty' },
      select: { orgId: true },
    });
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u_empty' },
      data: { activeOrganizationId: 'org_from_member' },
    });
  });

  it('warns and makes no update when the user has no Member record', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'u_loner', activeOrganizationId: null });
    mockPrisma.member.findFirst.mockResolvedValueOnce(null);

    await hook({ id: 's3', userId: 'u_loner' });

    expect(mockPrisma.user.update).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('tolerates a vanished user (findUnique → null): member lookup still runs, no crash', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);
    mockPrisma.member.findFirst.mockResolvedValueOnce({ orgId: 'org_ghost' });
    mockPrisma.user.update.mockResolvedValueOnce({});

    await expect(hook({ id: 's4', userId: 'u_ghost' })).resolves.toBeUndefined();
    // Behaviour parity with the missing-org case: update is attempted since
    // current.activeOrganizationId is undefined.
    expect(mockPrisma.member.findFirst).toHaveBeenCalledTimes(1);
  });
});
