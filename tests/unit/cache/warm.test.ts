/**
 * Unit tests for Cache Warming (lib/cache/warm.ts)
 *
 * Verifies that warmed L1 entries are also promoted to L2 (Redis) as
 * permanent entries, and that a per-entry L2 failure does not abort the
 * rest of the warm.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as lruModule from '@/lib/cache/lru';
import * as redisModule from '@/lib/redis';

// Mock dependencies — must be set up before module import
vi.mock('@/lib/env', () => ({
  env: {
    PLATFORM_ORGANIZATION_ID: 'platform-org-1',
  },
}));

vi.mock('@/lib/rls-transaction', () => ({
  withPlatformContextForDB: vi.fn(async (_orgId: string, op: () => Promise<unknown>) => op()),
}));

vi.mock('@/lib/tenant-db', () => ({
  __esModule: true,
  default: {
    organization: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    role: { findMany: vi.fn() },
    permission: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/cache/lru', () => ({
  getLruCache: vi.fn(),
}));

vi.mock('@/lib/redis', () => ({
  redisSet: vi.fn(),
}));

import tenantDb from '@/lib/tenant-db';

const mockOrgs = [
  { id: 'org1', name: 'Platform Org', slug: 'platform-org' },
  { id: 'org2', name: 'Other Org', slug: 'other-org' },
];

const mockUsers = [
  { id: 'user1', name: 'Admin User', email: 'admin@example.com' },
];

const mockRoles = (orgId: string) => [
  { id: 'role1', name: 'Owner', description: 'Full access' },
];

const mockPermissions = [
  { id: 'perm1', key: 'org:read', resource: 'org', action: 'read', description: 'Read orgs' },
];

describe('warmCache()', () => {
  let warmCache: typeof import('@/lib/cache/warm').warmCache;
  const mockLru = { set: vi.fn(), delete: vi.fn() };

  beforeEach(async () => {
    const warmModule = await import('@/lib/cache/warm');
    warmCache = warmModule.warmCache;

    vi.clearAllMocks();
    vi.mocked(lruModule.getLruCache).mockReturnValue(mockLru as any);

    (tenantDb.organization.findMany as any).mockResolvedValue(mockOrgs);
    (tenantDb.user.findMany as any).mockResolvedValue(mockUsers);
    (tenantDb.role.findMany as any).mockImplementation(async ({ organizationId }: { organizationId: string }) =>
      mockRoles(organizationId)
    );
    (tenantDb.permission.findMany as any).mockResolvedValue(mockPermissions);
    vi.mocked(redisModule.redisSet).mockResolvedValue(undefined);
  });

  it('writes every warmed entry to L1', async () => {
    await warmCache();

    expect(mockLru.set).toHaveBeenCalledWith(
      'org:org1',
      JSON.stringify({ id: 'org1', name: 'Platform Org', slug: 'platform-org' })
    );
  });

  it('promotes every L1 entry to L2 with identical serialized value and permanent (Infinity) TTL', async () => {
    await warmCache();

    expect(mockLru.set).toHaveBeenCalledTimes(vi.mocked(redisModule.redisSet).mock.calls.length);

    for (const [l2Key, l2Value] of vi.mocked(redisModule.redisSet).mock.calls) {
      const l1Call = mockLru.set.mock.calls.find(
        ([key]) => key === l2Key
      );
      expect(l1Call, `expected ${l2Key} to be in L1`).toBeDefined();
      // Same exact serialized string in both layers — no re-serialization drift
      expect(l1Call![1]).toBe(l2Value);
      // Permanent entries: no expiry
      expect(redisModule.redisSet).toHaveBeenCalledWith(l2Key, l2Value, Infinity);
    }

    // Spot-check a few key shapes: entity, search aggregation, list entry
    const l2Keys = vi.mocked(redisModule.redisSet).mock.calls.map((c) => c[0]);
    expect(l2Keys).toContain('org:org1');
    expect(l2Keys).toContain('search:org:platform org');
    expect(l2Keys).toContain('org:list:platform org');
    expect(l2Keys).toContain('role:org1:role1');
    expect(l2Keys).toContain('perm:catalog:org:read');
  });

  it('does not abort remaining entries when one L2 write fails', async () => {
    vi.mocked(redisModule.redisSet).mockImplementation(async (key) => {
      if (key === 'org:org1') throw new Error('redis down');
    });

    await warmCache();

    // org1 failed in L2 but every other entry was still promoted
    expect(vi.mocked(redisModule.redisSet)).toHaveBeenCalledWith(
      'org:org2',
      JSON.stringify({ id: 'org2', name: 'Other Org', slug: 'other-org' }),
      Infinity
    );
    // L1 still got the full set (per-key L1 catch would have logged otherwise)
    expect(mockLru.set).toHaveBeenCalled();
  });

  it('skips entirely (no L1, no L2) when PLATFORM_ORGANIZATION_ID is unset', async () => {
    const { env } = await import('@/lib/env');
    const saved = env.PLATFORM_ORGANIZATION_ID;
    // Temporarily strip the field for this test only
    env.PLATFORM_ORGANIZATION_ID = undefined;

    try {
      await warmCache();
    } finally {
      env.PLATFORM_ORGANIZATION_ID = saved;
    }

    expect(mockLru.set).not.toHaveBeenCalled();
    expect(redisModule.redisSet).not.toHaveBeenCalled();
  });

  it('skips entirely (no L1, no L2) when the L1 cache is unavailable', async () => {
    vi.mocked(lruModule.getLruCache).mockReturnValue(null);

    await warmCache();

    expect(redisModule.redisSet).not.toHaveBeenCalled();
  });
});
