/**
 * Mocked handler tests for settings API routes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// Mock all dependencies before importing the route
vi.mock('@/lib/require-super-admin', () => ({
  requireSuperAdmin: vi.fn(),
}));

vi.mock('@/lib/global-db', () => ({
  default: {
    organization: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), findFirst: vi.fn() },
    session: { deleteMany: vi.fn() },
    member: { count: vi.fn() },
  },
}));

vi.mock('@/lib/audit-log', () => ({
  recordAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/logger', () => {
  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { logger: mockLogger };
});

const { requireSuperAdmin } = await import('@/lib/require-super-admin');
const globalDb = (await import('@/lib/global-db')).default;
const { recordAuditLog } = await import('@/lib/audit-log');
const logger = (await import('@/lib/logger')).logger;

// Shared mock session with proper structure matching auth.api.getSession() return type
const mockSession = {
  session: { id: 'session-1', userId: 'admin-1' },
  user: { id: 'admin-1', name: 'Admin User' },
};

const { PATCH } = await import(
  '@/app/api/admin/organizations/[orgId]/settings/route'
);

describe('PATCH /api/admin/organizations/[orgId]/settings', () => {
  beforeEach(() => vi.clearAllMocks());

  function createParams(orgId: string) {
    return Promise.resolve({ orgId });
  }

  function createRequest(body: Record<string, unknown>) {
    return {
      json: () => Promise.resolve(body),
      headers: new Headers(),
    } as unknown as NextRequest;
  }

  it('should update organization settings when authorized', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1', status: 'ACTIVE' } as any);
    vi.mocked(globalDb.organization.update).mockResolvedValue({ id: 'org-1', name: 'Updated Org' } as any);

    const response = await PATCH(
      createRequest({ name: 'Updated Org' }),
      { params: createParams('org-1') }
    );

    expect(response.status).toBe(200);
  });

  it('should return 400 when no fields are provided', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    const response = await PATCH(
      createRequest({}),
      { params: createParams('org-1') }
    );

    expect(response.status).toBe(400);
  });

  it('should return 403 when not authorized', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      session: null,
      authorized: false,
      error: 'Unauthorized',
      status: 403,
    });

    const response = await PATCH(
      createRequest({ name: 'Updated' }),
      { params: createParams('org-1') }
    );

    expect(response.status).toBe(403);
  });

  it('should return 503 when database is unavailable', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockRejectedValue(
      new Error("Can't reach database server")
    );

    const response = await PATCH(
      createRequest({ name: 'Updated' }),
      { params: createParams('org-1') }
    );

    expect(response.status).toBe(503);
  });

  it('should return 404 when organization not found', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue(null);

    const response = await PATCH(
      createRequest({ name: 'Updated' }),
      { params: createParams('org-1') }
    );

    expect(response.status).toBe(404);
  });

  it('should return 400 for invalid status transition', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1', status: 'PENDING' } as any);

    const response = await PATCH(
      createRequest({ status: 'ARCHIVED' }), // PENDING → ARCHIVED is invalid
      { params: createParams('org-1') }
    );

    expect(response.status).toBe(400);
  });

  it('should return 409 for slug collision', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1', slug: 'original' } as any);
    vi.mocked(globalDb.organization.findFirst).mockResolvedValue({ id: 'other-org', slug: 'original-slug' } as any);

    const response = await PATCH(
      createRequest({ slug: 'original-slug' }),
      { params: createParams('org-1') }
    );

    expect(response.status).toBe(409);
  });

  it('should invalidate sessions when status changes to SUSPENDED', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1', status: 'ACTIVE' } as any);
    vi.mocked(globalDb.organization.update).mockResolvedValue({ id: 'org-1', status: 'SUSPENDED' } as any);

    await PATCH(
      createRequest({ status: 'SUSPENDED' }),
      { params: createParams('org-1') }
    );

    expect(globalDb.session.deleteMany).toHaveBeenCalled();
  });



  it('should record audit log on successful settings update', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1', status: 'ACTIVE' } as any);
    vi.mocked(globalDb.organization.update).mockResolvedValue({ id: 'org-1', name: 'Updated Org' } as any);

    await PATCH(
      createRequest({ name: 'Updated Org' }),
      { params: createParams('org-1') }
    );

    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'organization.settings_updated',
        success: true,
        resourceType: 'Organization',
      })
    );
  });

  it('should handle invalid JSON body gracefully', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    const response = await PATCH(
      { json: () => Promise.reject(new Error('Invalid JSON')), headers: new Headers() } as unknown as NextRequest,
      { params: createParams('org-1') }
    );

    expect(response.status).toBe(400);
  });

  it('should allow updating name only', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1', status: 'ACTIVE' } as any);
    vi.mocked(globalDb.organization.update).mockResolvedValue({ id: 'org-1', name: 'New Name' } as any);

    const response = await PATCH(
      createRequest({ name: 'New Name' }),
      { params: createParams('org-1') }
    );

    expect(response.status).toBe(200);
  });

  it('should allow updating slug only', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1', status: 'ACTIVE' } as any);
    vi.mocked(globalDb.organization.findFirst).mockResolvedValue(null);
    vi.mocked(globalDb.organization.update).mockResolvedValue({ id: 'org-1', slug: 'new-slug' } as any);

    const response = await PATCH(
      createRequest({ slug: 'new-slug' }),
      { params: createParams('org-1') }
    );

    expect(response.status).toBe(200);
  });

  it('should allow updating status only', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1', status: 'ACTIVE' } as any);
    vi.mocked(globalDb.organization.update).mockResolvedValue({ id: 'org-1', status: 'SUSPENDED' } as any);

    const response = await PATCH(
      createRequest({ status: 'SUSPENDED' }),
      { params: createParams('org-1') }
    );

    expect(response.status).toBe(200);
  });

  it('should allow updating multiple fields at once', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1', status: 'ACTIVE' } as any);
    vi.mocked(globalDb.organization.findFirst).mockResolvedValue(null);
    vi.mocked(globalDb.organization.update).mockResolvedValue({ id: 'org-1', name: 'New Name', slug: 'new-slug' } as any);

    const response = await PATCH(
      createRequest({ name: 'New Name', slug: 'new-slug' }),
      { params: createParams('org-1') }
    );

    expect(response.status).toBe(200);
  });
});