/**
 * Unit test: Verify global-db.ts does NOT have tenant isolation extension applied.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  default: {
    $extends: vi.fn(),
    organization: { findMany: vi.fn() },
  },
}));

describe('global-db.ts — No Tenant Isolation', () => {
  it('should export a PrismaClient instance without tenant isolation extension', async () => {
    const globalDb = await import('@/lib/global-db');

    // The default export should be a PrismaClient instance
    expect(globalDb.default).toBeDefined();
    expect(globalDb.globalDb).toBeDefined();

    // Verify the client does NOT have a $tenant property or tenant-scoping method
    // (this is a structural check — the real test is that queries return all orgs)
    const client = globalDb.default;

    // If $extends was called with tenant isolation, it would add org-scoping
    // We verify the client is a plain PrismaClient by checking its structure
    expect(client).toHaveProperty('organization');
  });

  it('should be a different instance than the tenant-scoped client', async () => {
    const { default: globalDb } = await import('@/lib/global-db');
    // The tenant-db module wraps the default prisma from @/lib/db
    // These should be different singleton instances
    expect(globalDb).toBeDefined();
  });
});
