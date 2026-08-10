import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/permissions/resolver', () => ({
  resolvePermissions: vi.fn(),
}));

vi.mock('@/lib/env', () => ({
  env: {
    PLATFORM_ORGANIZATION_ID: 'platform-org-id',
  },
}));

vi.mock('@/lib/tenant-context', () => ({
  runWithTenant: vi.fn(async (_orgId: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('@/lib/tenant-db', () => {
  const mockTenantDb = {
    member: { findFirst: vi.fn() },
    memberRole: { findMany: vi.fn() },
    organization: { findFirst: vi.fn() },
  };
  return { default: mockTenantDb, tenantDb: mockTenantDb };
});

import { hasPermission, isSuperAdmin } from '@/lib/authz';
import { resolvePermissions } from '@/lib/permissions/resolver';
import tenantDb from '@/lib/tenant-db';

describe('authz', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('hasPermission', () => {
    it('returns true when user has the permission', async () => {
      vi.mocked(resolvePermissions).mockResolvedValue(['properties:view', 'properties:create']);

      const result = await hasPermission('user-1', 'org-1', 'properties:create');

      expect(result).toBe(true);
      expect(resolvePermissions).toHaveBeenCalledWith('user-1', 'org-1');
    });

    it('returns false when user lacks the permission', async () => {
      vi.mocked(resolvePermissions).mockResolvedValue(['properties:view']);

      const result = await hasPermission('user-1', 'org-1', 'properties:create');

      expect(result).toBe(false);
    });

    it('returns false when resolver returns empty array', async () => {
      vi.mocked(resolvePermissions).mockResolvedValue([]);

      const result = await hasPermission('user-1', 'org-1', 'properties:create');

      expect(result).toBe(false);
    });

    it('returns false when resolver throws (graceful degradation)', async () => {
      vi.mocked(resolvePermissions).mockRejectedValue(new Error('Redis down'));

      const result = await hasPermission('user-1', 'org-1', 'properties:create');

      expect(result).toBe(false);
    });
  });

  describe('isSuperAdmin', () => {
    it('returns true when user is member of Platform Organization', async () => {
      vi.mocked(tenantDb.member.findFirst).mockResolvedValue({
        id: 'member-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        userId: 'user-1',
        orgId: 'platform-org-id',
        teamId: null,
        role: 'admin',
      });

      const result = await isSuperAdmin('user-1', 'platform-org-id');

      expect(result).toBe(true);
    });

    it('returns false when user is in a different organization', async () => {
      vi.mocked(tenantDb.member.findFirst).mockResolvedValue(null);

      const result = await isSuperAdmin('user-1', 'tenant-org-id');

      expect(result).toBe(false);
    });

    it('returns false when orgId is undefined', async () => {
      vi.mocked(tenantDb.member.findFirst).mockResolvedValue(null);

      const result = await isSuperAdmin('user-1', undefined);

      expect(result).toBe(false);
    });
  });
});