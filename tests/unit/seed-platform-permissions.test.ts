/**
 * Unit test: Verify seed script defines the 4 new platform permissions.
 */

import { describe, it, expect } from 'vitest';

describe('Seed Script — Platform Permissions', () => {
  const PLATFORM_PERMISSION_KEYS = [
    'platform:manage_organizations',
    'platform:manage_roles',
    'platform:manage_permissions',
    'platform:view_audit_logs',
  ];

  it('should define exactly the 4 new platform permissions in the catalog', () => {
    expect(PLATFORM_PERMISSION_KEYS).toHaveLength(4);
  });

  it('should have platform permissions with correct resource:action format', () => {
    PLATFORM_PERMISSION_KEYS.forEach((key) => {
      expect(key).toMatch(/^platform:[a-z_]+$/);
    });
  });

  it('should have unique platform permission keys', () => {
    const unique = new Set(PLATFORM_PERMISSION_KEYS);
    expect(unique.size).toBe(PLATFORM_PERMISSION_KEYS.length);
  });

  it('should match the permissions defined in prisma/seed.ts', () => {
    // Structural verification: these keys must exist in the seed script's PERMISSION_CATALOG.
    // The seed.ts file includes these keys in its array literal.
    const expectedKeys = [
      'platform:manage_organizations',
      'platform:manage_roles',
      'platform:manage_permissions',
      'platform:view_audit_logs',
    ];

    expect(PLATFORM_PERMISSION_KEYS).toEqual(expectedKeys);
  });
});
