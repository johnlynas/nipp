/**
 * Unit tests for pii-routes.ts — PII route configuration and matching.
 */

import { describe, it, expect } from 'vitest';
import { isPiiRoute, getPiiRoutePattern, normalizePath } from '@/lib/pii-routes';

describe('normalizePath', () => {
  it('should strip query strings', () => {
    expect(normalizePath('/api/users?q=test')).toBe('/api/users');
  });

  it('should remove trailing slashes', () => {
    expect(normalizePath('/api/users/')).toBe('/api/users');
  });

  it('should preserve root path', () => {
    expect(normalizePath('/')).toBe('/');
  });

  it('should preserve paths without query or trailing slash', () => {
    expect(normalizePath('/api/users/123')).toBe('/api/users/123');
  });

  it('should handle multiple query parameters', () => {
    expect(normalizePath('/api/users?page=1&limit=10')).toBe('/api/users');
  });

  it('should handle empty query string', () => {
    expect(normalizePath('/api/users?')).toBe('/api/users');
  });

  it('should remove one trailing slash', () => {
    // normalizePath only removes the last trailing slash
    expect(normalizePath('/api/users///')).toBe('/api/users//');
  });
});

describe('isPiiRoute', () => {
  it('should match exact PII routes', () => {
    expect(isPiiRoute('/api/admin/users/search')).toBe(true);
  });

  it('should match parameterized PII routes', () => {
    expect(isPiiRoute('/api/admin/organizations/org123/members')).toBe(true);
    expect(isPiiRoute('/api/admin/organizations/org123/members/member456')).toBe(true);
  });

  it('should not match non-PII routes', () => {
    expect(isPiiRoute('/api/health')).toBe(false);
    expect(isPiiRoute('/login')).toBe(false);
    expect(isPiiRoute('/api/auth/sign-in/email')).toBe(false);
  });

  it('should not overmatch on prefix similarity', () => {
    expect(isPiiRoute('/api/admin/organizations-public')).toBe(false);
  });

  it('should handle query strings', () => {
    expect(isPiiRoute('/api/admin/users/search?q=test')).toBe(true);
  });

  it('should handle trailing slashes', () => {
    expect(isPiiRoute('/api/admin/users/search/')).toBe(true);
  });

  it('should not match partial paths', () => {
    expect(isPiiRoute('/api/admin/users/search/extra')).toBe(false);
  });

  it('should match user-permissions route', () => {
    expect(isPiiRoute('/api/auth/user-permissions')).toBe(true);
  });

  it('should not match similar but different routes', () => {
    expect(isPiiRoute('/api/admin/organization')).toBe(false); // singular, not in patterns
  });

  it('should handle case sensitivity', () => {
    expect(isPiiRoute('/api/admin/Users/search')).toBe(false); // different case
  });

  it('should match dynamic route parameters', () => {
    expect(isPiiRoute('/api/admin/organizations/abc123/members')).toBe(true);
    expect(isPiiRoute('/api/admin/organizations/xyz789/members/member-abc')).toBe(true);
  });

  it('should match routes where params absorb segments', () => {
    // /api/admin/organizations/org123/members/extra has 6 segments
    // Pattern /api/admin/organizations/:orgId/members/:memberId also has 6 segments
    // So 'extra' matches :memberId — this is correct behavior for parameterized routes
    expect(isPiiRoute('/api/admin/organizations/org123/members/extra')).toBe(true);
  });

  it('should not match routes with extra segments on member route', () => {
    expect(isPiiRoute('/api/admin/organizations/org123/members/member456/extra')).toBe(false);
  });


});

describe('getPiiRoutePattern', () => {
  it('should return the matching pattern for exact routes', () => {
    expect(getPiiRoutePattern('/api/admin/users/search')).toBe('/api/admin/users/search');
  });

  it('should return the matching pattern for parameterized routes', () => {
    expect(getPiiRoutePattern('/api/admin/organizations/org123/members')).toBe(
      '/api/admin/organizations/:orgId/members',
    );
  });

  it('should return null for non-PII routes', () => {
    expect(getPiiRoutePattern('/api/health')).toBeNull();
  });

  it('should return null for unknown routes', () => {
    expect(getPiiRoutePattern('/api/unknown/route')).toBeNull();
  });

  it('should handle query strings', () => {
    expect(getPiiRoutePattern('/api/admin/users/search?q=test')).toBe(
      '/api/admin/users/search',
    );
  });

  it('should handle trailing slashes', () => {
    expect(getPiiRoutePattern('/api/admin/users/search/')).toBe(
      '/api/admin/users/search',
    );
  });

  it('should return null for non-matching routes with similar names', () => {
    expect(getPiiRoutePattern('/api/admin/organization')).toBeNull();
  });

  it('should match routes where params absorb extra-looking segments', () => {
    // /api/admin/organizations/org123/members/extra has 6 segments
    // Pattern /api/admin/organizations/:orgId/members/:memberId also has 6 segments
    // So 'extra' matches :memberId — this is correct behavior for parameterized routes
    expect(getPiiRoutePattern('/api/admin/organizations/org123/members/extra')).toBe(
      '/api/admin/organizations/:orgId/members/:memberId',
    );
  });
});
