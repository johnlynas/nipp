/**
 * RLS plan Phase 1D — toTenantContext builds a verified RLS context from a
 * resolved TenantAccess decision (no extra lookups).
 */
import { describe, it, expect } from 'vitest';
import type { ServiceContext } from '@/lib/services/types';
import { toTenantContext, type TenantAccess } from '@/lib/tenant-access';

const okAccess = (role: ServiceContext['role'], organizationId?: string): Extract<TenantAccess, { ok: true }> => ({
  ok: true,
  ctx: { userId: 'sess-user', role, organizationId },
});

describe('toTenantContext', () => {
  it('maps PLATFORM_ADMIN access to isPlatformAdmin=true', () => {
    expect(toTenantContext(okAccess('PLATFORM_ADMIN', 'org-target'), 'sess-user')).toEqual({
      userId: 'sess-user',
      orgId: 'org-target',
      isPlatformAdmin: true,
    });
  });

  it('maps TENANT_ADMIN / MEMBER access to isPlatformAdmin=false', () => {
    for (const role of ['TENANT_ADMIN', 'MEMBER'] as const) {
      const c = toTenantContext(okAccess(role, 'org-a'), 'sess-user');
      expect(c.isPlatformAdmin).toBe(false);
      expect(c.orgId).toBe('org-a');
    }
  });

  it('fail-closed on missing session userId', () => {
    expect(() => toTenantContext(okAccess('MEMBER', 'org-a'), '')).toThrow(/sessionUserId/);
  });

  it('fail-closed when access lacks an organizationId (RLS needs a target org)', () => {
    expect(() => toTenantContext(okAccess('PLATFORM_ADMIN'), 'u')).toThrow(/organizationId/);
  });
});
