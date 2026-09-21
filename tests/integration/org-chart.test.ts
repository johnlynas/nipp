/**
 * Integration tests: GET /api/organizations/[orgId]/org-chart — authz matrix
 * and tree shaping against the route handler.
 *
 * Mocking strategy (mirrors tests/integration/super-admin-integration.test.ts,
 * extended with top-level mutable mocks so per-test behaviour is stable):
 *   - auth.api.getSession        → controls the logged-in user
 *   - verifySuperAdmin           → controls super-admin verification
 *   - resolveTenantAccess        → controls the membership/super-admin gate
 *   - globalDb.organization      → controls the org data read
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import type { TenantAccess } from '@/lib/tenant-access';

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

vi.mock('@/lib/authz', () => ({
  verifySuperAdmin: vi.fn(),
}));

// Mutable mock: tests set resolveTenantAccessMock before calling the route.
export const resolveTenantAccessMock: { impl: () => TenantAccess } = {
  impl: () => ({ ok: false, status: 403, error: 'Forbidden' }),
};

vi.mock('@/lib/tenant-access', () => ({
  resolveTenantAccess: vi.fn((...args: unknown[]) => resolveTenantAccessMock.impl()),
  // Re-export for any type imports in the module graph.
}));

vi.mock('@/lib/tenant-db', () => ({
  default: {
    member: { findFirst: vi.fn() },
    organization: { findUnique: vi.fn() },
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = 'org-test';

function orgResult() {
  return {
    id: ORG_ID,
    name: 'Test Tenant',
    description: null,
    teams: [
      {
        id: 'team-a',
        slug: 'alpha',
        name: 'Alpha',
        description: null,
        members: [
          {
            id: 'tm-1',
            userId: 'user-admin',
            createdAt: new Date('2026-01-01T00:00:00Z'),
            user: { id: 'user-admin', name: 'Admin User', email: 'admin@tenant.test', image: null },
          },
          {
            id: 'tm-2',
            userId: 'user-multi',
            createdAt: new Date('2026-01-05T00:00:00Z'),
            user: { id: 'user-multi', name: 'Multi User', email: 'multi@tenant.test', image: null },
          },
        ],
      },
      {
        id: 'team-b',
        slug: 'beta',
        name: 'Beta',
        description: null,
        members: [
          {
            id: 'tm-3',
            userId: 'user-multi',
            createdAt: new Date('2026-01-02T00:00:00Z'),
            user: { id: 'user-multi', name: 'Multi User', email: 'multi@tenant.test', image: null },
          },
        ],
      },
    ],
    members: [
      {
        id: 'member-1',
        userId: 'user-admin',
        role: 'admin',
        user: { id: 'user-admin', name: 'Admin User', email: 'admin@tenant.test', image: null },
        memberRoles: [
          {
            role: {
              id: 'role-1',
              name: 'Organization Admin',
              permissions: [
                { permission: { key: 'properties:read' } },
                { permission: { key: 'properties:update' } },
              ],
            },
          },
        ],
      },
      {
        id: 'member-2',
        userId: 'user-multi',
        role: 'member',
        user: { id: 'user-multi', name: 'Multi User', email: 'multi@tenant.test', image: null },
        memberRoles: [],
      },
      {
        id: 'member-3',
        userId: 'user-solo',
        role: 'member',
        user: { id: 'user-solo', name: 'Solo User', email: 'solo@tenant.test', image: null },
        memberRoles: [],
      },
    ],
  };
}

function makeRequest(): NextRequest {
  const request = new Request(`http://localhost:3000/api/organizations/${ORG_ID}/org-chart`, {
    method: 'GET',
    headers: { cookie: 'better-auth.session_token=test' },
  });
  return new NextRequest(request.url, { method: request.method, headers: request.headers });
}

const routePath = '@/app/api/organizations/[orgId]/org-chart/route';

function mockSession(userId: string) {
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: userId, email: `${userId}@test.com`, name: 'Test User' },
    session: { userId, expires: new Date(Date.now() + 10000) },
  } as never);
}

function grantAccess(role: 'PLATFORM_ADMIN' | 'TENANT_ADMIN' | 'MEMBER', userId = 'user-admin') {
  resolveTenantAccessMock.impl = () => ({ ok: true, ctx: { userId, role, organizationId: ORG_ID } });
}

// ---------------------------------------------------------------------------
// Authz matrix + tree output
// ---------------------------------------------------------------------------

describe('GET /api/organizations/[orgId]/org-chart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTenantAccessMock.impl = () => ({ ok: false, status: 403, error: 'Forbidden' });
  });

  it('returns 401 for unauthenticated requests', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const { GET } = await import(routePath);
    const response = await GET(makeRequest(), { params: Promise.resolve({ orgId: ORG_ID }) });
    expect(response.status).toBe(401);
  });

  it('returns the gate error when the user has no access (403)', async () => {
    mockSession('stranger');
    resolveTenantAccessMock.impl = () => ({
      ok: false,
      status: 403,
      error: 'User is not a member of the platform organization',
    });

    const { GET } = await import(routePath);
    const response = await GET(makeRequest(), { params: Promise.resolve({ orgId: ORG_ID }) });
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toContain('not a member');
  });

  it('returns 200 + full tree for a tenant member (viewerCanEdit=false)', async () => {
    mockSession('user-admin');
    grantAccess('MEMBER');

    const globalDb = (await import('@/lib/tenant-db')).default as unknown as {
      organization: { findUnique: ReturnType<typeof vi.fn> };
    };
    globalDb.organization.findUnique.mockResolvedValue(orgResult());

    const { GET } = await import(routePath);
    const response = await GET(makeRequest(), { params: Promise.resolve({ orgId: ORG_ID }) });
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.organization.id).toBe(ORG_ID);
    expect(data.viewerCanEdit).toBe(false);
    expect(data.teams.map((t: { name: string }) => t.name)).toEqual(['Alpha', 'Beta']);
  });

  it('returns viewerCanEdit=true for tenant admins and super admins', async () => {
    mockSession('user-admin');
    grantAccess('PLATFORM_ADMIN', 'super-admin');

    const globalDb = (await import('@/lib/tenant-db')).default as unknown as {
      organization: { findUnique: ReturnType<typeof vi.fn> };
    };
    globalDb.organization.findUnique.mockResolvedValue(orgResult());

    const { GET } = await import(routePath);
    const response = await GET(makeRequest(), { params: Promise.resolve({ orgId: ORG_ID }) });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.viewerCanEdit).toBe(true);
  });

  it('renders each member under exactly one team (1:1 v1 rule)', async () => {
    mockSession('user-admin');
    grantAccess('TENANT_ADMIN');

    const globalDb = (await import('@/lib/tenant-db')).default as unknown as {
      organization: { findUnique: ReturnType<typeof vi.fn> };
    };
    globalDb.organization.findUnique.mockResolvedValue(orgResult());

    const { GET } = await import(routePath);
    const response = await GET(makeRequest(), { params: Promise.resolve({ orgId: ORG_ID }) });
    const data = await response.json();

    // Multi User belongs to alpha (joined 2026-01-05) AND beta (joined
    // 2026-01-02): primary = earliest createdAt = beta.
    const alpha = data.teams.find((t: { slug: string }) => t.slug === 'alpha');
    const beta = data.teams.find((t: { slug: string }) => t.slug === 'beta');
    expect(alpha.members.map((m: { userId: string }) => m.userId)).toEqual(['user-admin']);
    expect(beta.members.map((m: { userId: string }) => m.userId)).toEqual(['user-multi']);

    // The member node keeps BOTH team slugs (primary first) for display.
    const multi = beta.members[0];
    expect(multi.teams).toEqual(['beta', 'alpha']);

    // Solo User has no team membership → unassigned.
    expect(data.unassigned.map((m: { userId: string }) => m.userId)).toEqual(['user-solo']);
  });

  it('includes roles and permission keys on member nodes', async () => {
    mockSession('user-admin');
    grantAccess('TENANT_ADMIN');

    const globalDb = (await import('@/lib/tenant-db')).default as unknown as {
      organization: { findUnique: ReturnType<typeof vi.fn> };
    };
    globalDb.organization.findUnique.mockResolvedValue(orgResult());

    const { GET } = await import(routePath);
    const response = await GET(makeRequest(), { params: Promise.resolve({ orgId: ORG_ID }) });
    const data = await response.json();

    const admin = data.teams.find((t: { slug: string }) => t.slug === 'alpha').members[0];
    expect(admin.memberRole).toBe('admin');
    expect(admin.assignedRoles).toEqual([
      {
        id: 'role-1',
        name: 'Organization Admin',
        permissionCount: 2,
        permissions: ['properties:read', 'properties:update'],
      },
    ]);
  });

  it('returns 404 for a missing organization', async () => {
    mockSession('user-admin');
    grantAccess('TENANT_ADMIN');

    const globalDb = (await import('@/lib/tenant-db')).default as unknown as {
      organization: { findUnique: ReturnType<typeof vi.fn> };
    };
    globalDb.organization.findUnique.mockResolvedValue(null);

    const { GET } = await import(routePath);
    const response = await GET(makeRequest(), { params: Promise.resolve({ orgId: ORG_ID }) });
    expect(response.status).toBe(404);
  });
});
