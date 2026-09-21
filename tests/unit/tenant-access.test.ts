/**
 * Unit tests: resolveTenantAccess — membership OR super admin resolution.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/tenant-db', () => ({
  default: {
    member: { findFirst: vi.fn() },
  },
}));

vi.mock('@/lib/authz', () => ({
  verifySuperAdmin: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));

import globalDb from '@/lib/tenant-db';
import { resolveTenantAccess } from '@/lib/tenant-access';
import { verifySuperAdmin } from '@/lib/authz';

describe('resolveTenantAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves TENANT_ADMIN for an admin membership', async () => {
    vi.mocked(globalDb.member.findFirst).mockResolvedValue({ role: 'admin' } as never);

    const result = await resolveTenantAccess({} as never, 'user-1', 'org-tenant');
    expect(result).toEqual({ ok: true, ctx: { userId: 'user-1', role: 'TENANT_ADMIN', organizationId: 'org-tenant' } });
    // Super admin check must not be consulted for members
    expect(verifySuperAdmin).not.toHaveBeenCalled();
  });

  it('resolves MEMBER for a non-admin membership', async () => {
    vi.mocked(globalDb.member.findFirst).mockResolvedValue({ role: 'member' } as never);

    const result = await resolveTenantAccess({} as never, 'user-1', 'org-tenant');
    expect(result).toEqual({ ok: true, ctx: { userId: 'user-1', role: 'MEMBER', organizationId: 'org-tenant' } });
  });

  it('resolves PLATFORM_ADMIN for a super admin with no membership in the org', async () => {
    vi.mocked(globalDb.member.findFirst).mockResolvedValue(null);
     
    (verifySuperAdmin as any).mockResolvedValue({ authorized: true });

    const result = await resolveTenantAccess({} as never, 'platform-user', 'org-other-tenant');
    expect(result).toEqual({ ok: true, ctx: { userId: 'platform-user', role: 'PLATFORM_ADMIN', organizationId: 'org-other-tenant' } });
  });

  it('returns 403 for a non-member who is not a super admin', async () => {
    vi.mocked(globalDb.member.findFirst).mockResolvedValue(null);
     
    (verifySuperAdmin as any).mockResolvedValue({ authorized: false, error: 'User is not a member of the platform organization' });

    const result = await resolveTenantAccess({} as never, 'stranger', 'org-tenant');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.error).toBe('User is not a member of the platform organization');
    }
  });

  it('fails closed with 503 when super admin verification hits a database error', async () => {
    vi.mocked(globalDb.member.findFirst).mockResolvedValue(null);
     
    (verifySuperAdmin as any).mockResolvedValue({ authorized: false, error: 'Database unavailable, authorization cannot be verified' });

    const result = await resolveTenantAccess({} as never, 'stranger', 'org-tenant');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(503);
    }
  });

  it('fails closed with 503 when the platform organization cannot be found', async () => {
    vi.mocked(globalDb.member.findFirst).mockResolvedValue(null);
     
    (verifySuperAdmin as any).mockResolvedValue({ authorized: false, error: 'Platform organization not found' });

    const result = await resolveTenantAccess({} as never, 'stranger', 'org-tenant');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(503);
    }
  });

  // Phase 3: the S7 superAdminStorage.run(true, …) wrapper no longer exists —
  // readMembershipForAccessCheck binds a verified platform RLS context via
  // withExplicitRLS instead (covered by tests/unit/rls-transaction.test.ts).
});
