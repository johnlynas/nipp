/**
 * Unit tests for service-layer authorization helper functions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requirePlatformAdmin, requireTenantAdmin, requireAnyAdmin, resolveOrgScope } from '@/lib/services/base-service';
import { ForbiddenError, ValidationError } from '@/lib/services/types';

// Mock logger to suppress output
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockCtx = (role: 'PLATFORM_ADMIN' | 'TENANT_ADMIN' | 'MEMBER', orgId?: string) => ({
  userId: 'user-1',
  role,
  organizationId: orgId,
});

describe('Authorization Helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('requirePlatformAdmin', () => {
    it('passes for PLATFORM_ADMIN', () => {
      expect(() => requirePlatformAdmin(mockCtx('PLATFORM_ADMIN'))).not.toThrow();
    });

    it('throws ForbiddenError for TENANT_ADMIN', () => {
      expect(() => requirePlatformAdmin(mockCtx('TENANT_ADMIN')))
        .toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for MEMBER', () => {
      expect(() => requirePlatformAdmin(mockCtx('MEMBER')))
        .toThrow(ForbiddenError);
    });

    it('throws with correct message', () => {
      try {
        requirePlatformAdmin(mockCtx('TENANT_ADMIN'));
      } catch (err) {
        expect((err as ForbiddenError).message).toBe('Platform Admin access required');
      }
    });
  });

  describe('requireTenantAdmin', () => {
    it('passes for TENANT_ADMIN with matching orgId', () => {
      expect(() => requireTenantAdmin(mockCtx('TENANT_ADMIN', 'org-1'), 'org-1')).not.toThrow();
    });

    it('throws ForbiddenError for PLATFORM_ADMIN', () => {
      expect(() => requireTenantAdmin(mockCtx('PLATFORM_ADMIN'), 'org-1'))
        .toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for MEMBER', () => {
      expect(() => requireTenantAdmin(mockCtx('MEMBER'), 'org-1'))
        .toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for cross-org TENANT_ADMIN', () => {
      expect(() => requireTenantAdmin(mockCtx('TENANT_ADMIN', 'org-1'), 'org-2'))
        .toThrow(ForbiddenError);
    });

    it('throws with correct message for MEMBER', () => {
      try {
        requireTenantAdmin(mockCtx('MEMBER'), 'org-1');
      } catch (err) {
        expect((err as ForbiddenError).message).toBe('Member access denied — admin role required');
      }
    });

    it('throws with correct message for cross-org', () => {
      try {
        requireTenantAdmin(mockCtx('TENANT_ADMIN', 'org-1'), 'org-2');
      } catch (err) {
        expect((err as ForbiddenError).message).toBe('Cannot access resources outside your organization');
      }
    });
  });

  describe('requireAnyAdmin', () => {
    it('passes for PLATFORM_ADMIN', () => {
      expect(() => requireAnyAdmin(mockCtx('PLATFORM_ADMIN'))).not.toThrow();
    });

    it('passes for TENANT_ADMIN', () => {
      expect(() => requireAnyAdmin(mockCtx('TENANT_ADMIN'))).not.toThrow();
    });

    it('throws ForbiddenError for MEMBER', () => {
      expect(() => requireAnyAdmin(mockCtx('MEMBER')))
        .toThrow(ForbiddenError);
    });

    it('throws with correct message for MEMBER', () => {
      try {
        requireAnyAdmin(mockCtx('MEMBER'));
      } catch (err) {
        expect((err as ForbiddenError).message).toBe('Member access denied — admin role required');
      }
    });
  });

  describe('resolveOrgScope', () => {
    it('returns explicit targetOrgId when provided', () => {
      expect(resolveOrgScope(mockCtx('PLATFORM_ADMIN'), 'org-2')).toBe('org-2');
    });

    it('returns ctx.organizationId when targetOrgId is undefined', () => {
      expect(resolveOrgScope(mockCtx('TENANT_ADMIN', 'org-1'), undefined)).toBe('org-1');
    });

    it('prefers targetOrgId over ctx.organizationId', () => {
      expect(resolveOrgScope(mockCtx('PLATFORM_ADMIN', 'org-1'), 'org-2')).toBe('org-2');
    });

    it('returns undefined when neither is available', () => {
      expect(resolveOrgScope(mockCtx('PLATFORM_ADMIN'), undefined)).toBeUndefined();
    });


  });
});
