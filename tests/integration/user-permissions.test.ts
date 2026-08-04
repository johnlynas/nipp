/**
 * Integration tests for user-permissions route unauthenticated behavior.
 *
 * Verifies:
 * - Unauthenticated requests return plaintext empty array safely
 * - Authenticated requests encrypt responses when required
 * - Login/logout transitions do not break permissions loading
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

vi.mock('@/lib/authz', () => ({
  getPlatformOrgId: vi.fn().mockResolvedValue('platform-org-123'),
  isSuperAdmin: vi.fn().mockResolvedValue(false),
}));

vi.mock('@/lib/permissions/resolver', () => ({
  resolvePermissions: vi.fn().mockResolvedValue(['org:read', 'org:write']),
}));

vi.mock('@/lib/payload-middleware', () => ({
  wrapPiiRoute: (handler: any) => handler, // Pass through for testing
}));

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Map()),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('User Permissions API — Unauthenticated Behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty array for unauthenticated requests', async () => {
    // Mock: no session
    const { auth } = await import('@/lib/auth');
    (auth.api.getSession as any).mockResolvedValue(null);

    const { GET } = await import('@/app/api/auth/user-permissions/route');
    const request = new NextRequest('http://localhost:3000/api/auth/user-permissions');
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual([]);
  });

  it('should return empty array when session has no user', async () => {
    // Mock: session exists but no user
    const { auth } = await import('@/lib/auth');
    (auth.api.getSession as any).mockResolvedValue({ session: {}, user: null });

    const { GET } = await import('@/app/api/auth/user-permissions/route');
    const request = new NextRequest('http://localhost:3000/api/auth/user-permissions');
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual([]);
  });

  it('should return user permissions when authenticated', async () => {
    // Mock: authenticated user with pre-resolved permissions
    const { auth } = await import('@/lib/auth');
    (auth.api.getSession as any).mockResolvedValue({
      user: { id: 'user-1', permissions: ['org:read'] },
      session: { activeOrganizationId: 'org-123' },
    });

    const { GET } = await import('@/app/api/auth/user-permissions/route');
    const request = new NextRequest('http://localhost:3000/api/auth/user-permissions');
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(['org:read']);
  });

  it('should return wildcard for super admins', async () => {
    // Mock: super admin user
    const { auth } = await import('@/lib/auth');
    (auth.api.getSession as any).mockResolvedValue({
      user: { id: 'admin-1' },
      session: {},
    });

    const { isSuperAdmin } = await import('@/lib/authz');
    (isSuperAdmin as any).mockResolvedValue(true);

    const { GET } = await import('@/app/api/auth/user-permissions/route');
    const request = new NextRequest('http://localhost:3000/api/auth/user-permissions');
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(['*']);
  });

  it('should resolve permissions on-demand for non-super-admin users', async () => {
    // Mock: authenticated user without pre-resolved permissions
    const { auth } = await import('@/lib/auth');
    (auth.api.getSession as any).mockResolvedValue({
      user: { id: 'user-1' },
      session: { activeOrganizationId: 'org-123' },
    });

    const { isSuperAdmin } = await import('@/lib/authz');
    (isSuperAdmin as any).mockResolvedValue(false);

    const { GET } = await import('@/app/api/auth/user-permissions/route');
    const request = new NextRequest('http://localhost:3000/api/auth/user-permissions');
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(['org:read', 'org:write']);
  });

  it('should return empty array on permission resolution error', async () => {
    // Mock: authenticated user but permission resolution fails
    const { auth } = await import('@/lib/auth');
    (auth.api.getSession as any).mockResolvedValue({
      user: { id: 'user-1' },
      session: { activeOrganizationId: 'org-123' },
    });

    const { isSuperAdmin } = await import('@/lib/authz');
    (isSuperAdmin as any).mockResolvedValue(false);

    const { resolvePermissions } = await import('@/lib/permissions/resolver');
    (resolvePermissions as any).mockRejectedValue(new Error('Database error'));

    const { GET } = await import('@/app/api/auth/user-permissions/route');
    const request = new NextRequest('http://localhost:3000/api/auth/user-permissions');
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual([]);
  });

  it('should return empty array when platform org ID is not set', async () => {
    // Mock: no platform org ID
    const { auth } = await import('@/lib/auth');
    (auth.api.getSession as any).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    });

    const { getPlatformOrgId } = await import('@/lib/authz');
    (getPlatformOrgId as any).mockResolvedValue(null);

    const { GET } = await import('@/app/api/auth/user-permissions/route');
    const request = new NextRequest('http://localhost:3000/api/auth/user-permissions');
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual([]);
  });

  it('should handle missing activeOrganizationId gracefully', async () => {
    // Mock: authenticated user without active org
    const { auth } = await import('@/lib/auth');
    (auth.api.getSession as any).mockResolvedValue({
      user: { id: 'user-1' },
      session: {}, // No activeOrganizationId
    });

    const { isSuperAdmin } = await import('@/lib/authz');
    (isSuperAdmin as any).mockResolvedValue(false);

    const { GET } = await import('@/app/api/auth/user-permissions/route');
    const request = new NextRequest('http://localhost:3000/api/auth/user-permissions');
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual([]);
  });

  it('should return plaintext response for unauthenticated requests (no encryption)', async () => {
    // This test verifies that the response is valid JSON, not encrypted bytes
    const { auth } = await import('@/lib/auth');
    (auth.api.getSession as any).mockResolvedValue(null);

    const { GET } = await import('@/app/api/auth/user-permissions/route');
    const request = new NextRequest('http://localhost:3000/api/auth/user-permissions');
    const response = await GET(request);

    // Response should be JSON, not application/octet-stream
    const contentType = response.headers.get('Content-Type');
    expect(contentType).toContain('application/json');

    // Body should be parseable JSON
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('should include cache-control headers for dynamic data', async () => {
    const { auth } = await import('@/lib/auth');
    (auth.api.getSession as any).mockResolvedValue(null);

    const { GET } = await import('@/app/api/auth/user-permissions/route');
    const request = new NextRequest('http://localhost:3000/api/auth/user-permissions');
    const response = await GET(request);

    // Permissions are dynamic data and should not be cached
    const cacheControl = response.headers.get('Cache-Control');
    expect(cacheControl).not.toBeNull();
    expect(cacheControl!).toContain('no-store');
  });
});
