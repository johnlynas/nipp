/**
 * Mocked handler tests for settings API routes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// Mock all dependencies before importing the route
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue({
        user: { id: 'admin-1', name: 'Admin User' },
        session: { id: 'session-1', activeOrganizationId: null },
      }),
    },
  },
}));

vi.mock('@/lib/authz', () => ({
  verifySuperAdmin: vi.fn().mockResolvedValue({ authorized: true, error: undefined }),
}));

vi.mock('@/lib/tenant-db', () => ({
  default: {
    organization: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), findFirst: vi.fn() },
    session: { deleteMany: vi.fn() },
    member: { count: vi.fn() },
  },
}));

vi.mock('@/lib/platform-db', () => ({
  // Pass-through: these unit tests exercise route logic with mocked tenantDb;
  // the verified platform-admin RLS wrapper itself is covered by
  // tests/unit/rls-transaction.test.ts.
  withTenantAdminContext: vi.fn(async (_userId: string, _orgId: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('@/lib/audit-log', () => ({
  recordAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const globalDb = (await import('@/lib/tenant-db')).default;
const { recordAuditLog } = await import('@/lib/audit-log');
const { auth } = await import('@/lib/auth');

const { PATCH } = await import(
  '@/app/api/admin/organizations/[orgId]/settings/route'
);

describe('PATCH /api/admin/organizations/[orgId]/settings', () => {
  beforeEach(() => vi.clearAllMocks());

  function createRequest(body: Record<string, unknown>, orgId = 'org-123') {
    return {
      url: `http://localhost:3000/api/admin/organizations/${orgId}`,
      json: () => Promise.resolve(body),
      headers: new Headers(),
      method: 'PATCH',
    } as unknown as NextRequest;
  }

  it('should update organization settings when authorized', async () => {
    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1', status: 'ACTIVE' } as any);
    vi.mocked(globalDb.organization.update).mockResolvedValue({ id: 'org-1', name: 'Updated Org' } as any);

    const response = await PATCH(createRequest({ name: 'Updated Org' }));

    expect(response.status).toBe(200);
  });

  it('should return 400 when no fields are provided', async () => {
    const response = await PATCH(createRequest({}));

    expect(response.status).toBe(400);
  });

  it('should return 401 when not authorized', async () => {
    vi.mocked(auth.api.getSession).mockImplementationOnce(() => Promise.resolve(null));

    const response = await PATCH(createRequest({ name: 'Updated' }));

    expect(response.status).toBe(401);
  });

  it('should return 503 when database is unavailable', async () => {
    vi.mocked(globalDb.organization.findUnique).mockRejectedValue(
      new Error("Can't reach database server")
    );

    const response = await PATCH(createRequest({ name: 'Updated' }));

    expect(response.status).toBe(503);
  });

  it('should return 404 when organization not found', async () => {
    vi.mocked(globalDb.organization.findUnique).mockResolvedValue(null);

    const response = await PATCH(createRequest({ name: 'Updated' }));

    expect(response.status).toBe(404);
  });

  it('should return 400 for invalid status transition', async () => {
    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1', status: 'PENDING' } as any);

    const response = await PATCH(createRequest({ status: 'ARCHIVED' })); // PENDING → ARCHIVED is invalid

    expect(response.status).toBe(400);
  });

  it('should return 409 for slug collision', async () => {
    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1', slug: 'original' } as any);
    vi.mocked(globalDb.organization.findFirst).mockResolvedValue({ id: 'other-org', slug: 'original-slug' } as any);

    const response = await PATCH(createRequest({ slug: 'original-slug' }));

    expect(response.status).toBe(409);
  });

  it('should invalidate sessions when status changes to SUSPENDED', async () => {
    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1', status: 'ACTIVE' } as any);
    vi.mocked(globalDb.organization.update).mockResolvedValue({ id: 'org-1', status: 'SUSPENDED' } as any);

    await PATCH(createRequest({ status: 'SUSPENDED' }));

    expect(globalDb.session.deleteMany).toHaveBeenCalled();
  });

  it('should record audit log on successful settings update', async () => {
    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1', status: 'ACTIVE' } as any);
    vi.mocked(globalDb.organization.update).mockResolvedValue({ id: 'org-1', name: 'Updated Org' } as any);

    await PATCH(createRequest({ name: 'Updated Org' }));

    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'organization.settings_updated',
        success: true,
        resourceType: 'Organization',
      })
    );
  });

  it('should handle invalid JSON body gracefully', async () => {
    const response = await PATCH(
      { json: () => Promise.reject(new Error('Invalid JSON')), headers: new Headers(), url: 'http://localhost:3000/api/admin/organizations/org-123', method: 'PATCH' } as unknown as NextRequest
    );

    expect(response.status).toBe(400);
  });

  it('should allow updating name only', async () => {
    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1', status: 'ACTIVE' } as any);
    vi.mocked(globalDb.organization.update).mockResolvedValue({ id: 'org-1', name: 'New Name' } as any);

    const response = await PATCH(createRequest({ name: 'New Name' }));

    expect(response.status).toBe(200);
  });

  it('should allow updating slug only', async () => {
    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1', status: 'ACTIVE' } as any);
    vi.mocked(globalDb.organization.findFirst).mockResolvedValue(null);
    vi.mocked(globalDb.organization.update).mockResolvedValue({ id: 'org-1', slug: 'new-slug' } as any);

    const response = await PATCH(createRequest({ slug: 'new-slug' }));

    expect(response.status).toBe(200);
  });

  it('should allow updating status only', async () => {
    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1', status: 'ACTIVE' } as any);
    vi.mocked(globalDb.organization.update).mockResolvedValue({ id: 'org-1', status: 'SUSPENDED' } as any);

    const response = await PATCH(createRequest({ status: 'SUSPENDED' }));

    expect(response.status).toBe(200);
  });

  it('should allow updating multiple fields at once', async () => {
    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1', status: 'ACTIVE' } as any);
    vi.mocked(globalDb.organization.findFirst).mockResolvedValue(null);
    vi.mocked(globalDb.organization.update).mockResolvedValue({ id: 'org-1', name: 'New Name', slug: 'new-slug' } as any);

    const response = await PATCH(createRequest({ name: 'New Name', slug: 'new-slug' }));

    expect(response.status).toBe(200);
  });
});
