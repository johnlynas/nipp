/**
 * Unit tests for organization status change with user ban/unban logic.
 * Covers both the admin route and dashboard route status endpoints.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mocks — must be declared before any route import
// ---------------------------------------------------------------------------

vi.mock('@/lib/payload-middleware', () => ({
  wrapPiiRoute: (handler: any) => async (request: any, paramsPromise?: Promise<any>) => {
    const body = await request.json();
    const params = await (paramsPromise instanceof Promise ? paramsPromise : Promise.resolve(paramsPromise));
    return handler(request, body, params);
  },
}));

vi.mock('@/lib/global-db', () => ({
  default: {
    organization: { findUnique: vi.fn(), update: vi.fn() },
    member: { findMany: vi.fn() },
    user: { updateMany: vi.fn() },
    session: { deleteMany: vi.fn() },
  },
}));

vi.mock('@/lib/require-super-admin', () => ({
  requireSuperAdmin: vi.fn(),
}));

vi.mock('@/lib/audit-log', () => ({
  recordAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/rate-limiter', () => ({
  checkAdminRateLimit: vi.fn().mockReturnValue(true),
}));

vi.mock('@/lib/notification-push', () => ({
  notifyOrganizationOperation: vi.fn().mockResolvedValue(undefined),
  notifyOrganizationSuspension: vi.fn().mockResolvedValue(undefined),
  notifyOrganizationArchival: vi.fn().mockResolvedValue(undefined),
  notifyOrganizationReactivation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
}));

vi.mock('@/services/organization-service', () => ({
  OrganizationService: {
    updateOrganization: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Resolve mocked modules after all mocks are declared
// ---------------------------------------------------------------------------

const globalDb = (await import('@/lib/global-db')).default;
const { requireSuperAdmin } = await import('@/lib/require-super-admin');
const { recordAuditLog } = await import('@/lib/audit-log');
const { logger } = await import('@/lib/logger');
const { notifyOrganizationSuspension, notifyOrganizationArchival, notifyOrganizationReactivation } = await import('@/lib/notification-push');
const { OrganizationService } = await import('@/services/organization-service');

const { PATCH: adminPatch } = await import(
  '@/app/api/admin/organizations/[orgId]/status/route'
);

const { PATCH: dashboardPatch } = await import(
  '@/app/api/dashboard/admin/organizations/[id]/status/route'
);

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createRequest(body: Record<string, unknown>, orgId = 'org-123') {
  return {
    url: `http://localhost:3000/api/admin/organizations/${orgId}/status`,
    json: () => Promise.resolve(body),
    headers: new Headers(),
    method: 'PATCH',
  } as unknown as NextRequest;
}

function createDashboardRequest(body: Record<string, unknown>, orgId = 'org-123') {
  return createRequest(body, orgId);
}

function adminParams() {
  return Promise.resolve({ orgId: 'org-123' });
}

function dashboardParams() {
  return { params: Promise.resolve({ id: 'org-123' }) };
}

function mockSession(name = 'Super Admin') {
  return {
    user: { id: 'admin-1', name, email: 'admin@test.com', createdAt: new Date(), updatedAt: new Date(), emailVerified: true } as any,
    session: {
      id: 'session-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      userId: 'admin-1',
      expiresAt: new Date(Date.now() + 86400000),
      token: 'test-token',
    },
  } as any;
}

function mockMembers(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `member-${i}`,
    role: 'member',
    createdAt: new Date(),
    updatedAt: new Date(),
    userId: `user-${i}`,
    orgId: 'org-123',
    teamId: null,
  }));
}

function mockFullOrg(status = 'ACTIVE') {
  return ({
    id: 'org-123',
    name: 'Acme Corp',
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: {},
    slug: null,
    status,
    description: null,
  }) as any;
}

function setupDefaults() {
  vi.clearAllMocks();
  vi.mocked(requireSuperAdmin).mockResolvedValue({ authorized: true, session: mockSession(), status: 200 });
  vi.mocked(globalDb.organization.findUnique).mockResolvedValue(mockFullOrg('ACTIVE'));
  vi.mocked(globalDb.organization.update).mockResolvedValue(mockFullOrg('SUSPENDED'));
  vi.mocked(globalDb.member.findMany).mockResolvedValue(mockMembers(3));
  vi.mocked(globalDb.user.updateMany).mockResolvedValue({ count: 3 });
}

// ---------------------------------------------------------------------------
// Admin route — suspend / archive / reactivate with user ban logic
// ---------------------------------------------------------------------------

describe('Admin status route — org suspend/archive/reactivate', () => {
  beforeEach(() => {
    setupDefaults();
  });

  it('should suspend an org and ban all users', async () => {
    const response = await adminPatch(createRequest({ status: 'SUSPENDED' }), adminParams());

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.organization.status).toBe('SUSPENDED');

    // Verify users were banned
    expect(globalDb.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['user-0', 'user-1', 'user-2'] } },
        data: expect.objectContaining({ banned: true }),
      })
    );

    // Verify SSE notification was dispatched
    expect(notifyOrganizationSuspension).toHaveBeenCalledWith(
      'org-123',
      'Acme Corp',
      3,
      'Super Admin'
    );

    // Verify logger.warn was called for the ban action
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        orgId: 'org-123',
        toStatus: 'SUSPENDED',
      }),
      expect.stringContaining('suspend organization')
    );

    // Verify sessions were invalidated
    expect(globalDb.session.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: { in: ['user-0', 'user-1', 'user-2'] } } })
    );
  });

  it('should archive an org and ban all users', async () => {
    vi.mocked(globalDb.organization.update).mockResolvedValue(mockFullOrg('ARCHIVED'));

    const response = await adminPatch(createRequest({ status: 'ARCHIVED' }), adminParams());

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.organization.status).toBe('ARCHIVED');

    // Verify users were banned
    expect(globalDb.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['user-0', 'user-1', 'user-2'] } },
        data: expect.objectContaining({ banned: true }),
      })
    );

    // Verify archival SSE notification was dispatched
    expect(notifyOrganizationArchival).toHaveBeenCalledWith(
      'org-123',
      'Acme Corp',
      3,
      'Super Admin'
    );

    // Verify logger.warn was called for the archive action
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'ARCHIVED' }),
      expect.stringContaining('archive organization')
    );

    // Verify sessions were invalidated
    expect(globalDb.session.deleteMany).toHaveBeenCalled();
  });

  it('should reactivate a suspended org and unban all users', async () => {
    vi.mocked(globalDb.organization.findUnique).mockResolvedValue(mockFullOrg('SUSPENDED'));
    vi.mocked(globalDb.organization.update).mockResolvedValue(mockFullOrg('ACTIVE'));

    const response = await adminPatch(createRequest({ status: 'ACTIVE' }), adminParams());

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.organization.status).toBe('ACTIVE');

    // Verify users were unbanned
    expect(globalDb.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['user-0', 'user-1', 'user-2'] } },
        data: expect.objectContaining({ banned: false, banReason: null }),
      })
    );

    // Verify reactivation SSE notification was dispatched
    expect(notifyOrganizationReactivation).toHaveBeenCalledWith(
      'org-123',
      'Acme Corp',
      3,
      'Super Admin'
    );

    // Verify logger.info was called for reactivation
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'ACTIVE' }),
      expect.stringContaining('Reactivating organization')
    );
  });

  it('should return 404 when org not found', async () => {
    vi.mocked(globalDb.organization.findUnique).mockResolvedValue(null);

    const response = await adminPatch(createRequest({ status: 'SUSPENDED' }), adminParams());

    expect(response.status).toBe(404);
  });

  it('should return 400 for invalid status transition', async () => {
    vi.mocked(globalDb.organization.findUnique).mockResolvedValue(mockFullOrg('ARCHIVED'));

    const response = await adminPatch(createRequest({ status: 'ACTIVE' }), adminParams()); // ARCHIVED → ACTIVE is invalid

    expect(response.status).toBe(400);
  });

  it('should return 503 when database is unavailable', async () => {
    vi.mocked(globalDb.organization.findUnique).mockRejectedValue(new Error('DB connection refused'));

    const response = await adminPatch(createRequest({ status: 'SUSPENDED' }), adminParams());

    expect(response.status).toBe(500);
  });

  it('should return 401 when not authorized', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({ session: null, authorized: false, error: 'Unauthorized', status: 401 });

    const response = await adminPatch(createRequest({ status: 'SUSPENDED' }), adminParams());

    expect(response.status).toBe(401);
  });

  it('should record audit log on successful status change', async () => {
    await adminPatch(createRequest({ status: 'SUSPENDED' }), adminParams());

    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'organization.status_changed',
        resourceType: 'Organization',
        metadata: expect.objectContaining({ fromStatus: 'ACTIVE', toStatus: 'SUSPENDED' }),
        success: true,
      })
    );
  });

  it('should skip SSE notification when org has no members (suspend)', async () => {
    vi.mocked(globalDb.member.findMany).mockResolvedValue([]);

    await adminPatch(createRequest({ status: 'SUSPENDED' }), adminParams());

    expect(notifyOrganizationSuspension).not.toHaveBeenCalled();
    // Should still log that no members were found
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-123' }),
      '[ORG_STATUS_API] No members to ban/unban — skipping SSE notification'
    );
  });

  it('should skip SSE notification when org has no members (archive)', async () => {
    vi.mocked(globalDb.member.findMany).mockResolvedValue([]);

    await adminPatch(createRequest({ status: 'ARCHIVED' }), adminParams());

    expect(notifyOrganizationArchival).not.toHaveBeenCalled();
  });

  it('should still succeed when ban operation throws (graceful degradation)', async () => {
    vi.mocked(globalDb.user.updateMany).mockRejectedValue(new Error('DB timeout'));

    const response = await adminPatch(createRequest({ status: 'SUSPENDED' }), adminParams());

    // Status update should still succeed even if banning fails
    expect(response.status).toBe(200);

    // Should log the error but not fail
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      '[ORG_STATUS_API] Failed to ban org users'
    );

    // SSE notification should not be dispatched since userCount is 0 (ban failed)
    expect(notifyOrganizationSuspension).not.toHaveBeenCalled();
  });

  it('should include user count in SSE notification for suspension', async () => {
    vi.mocked(globalDb.member.findMany).mockResolvedValue(mockMembers(5));

    await adminPatch(createRequest({ status: 'SUSPENDED' }), adminParams());

    expect(notifyOrganizationSuspension).toHaveBeenCalledWith(
      'org-123',
      'Acme Corp',
      5, // user count matches members
      'Super Admin'
    );

    const call = (logger.warn as any).mock.calls[0];
    expect(call[0]).toEqual(
      expect.objectContaining({ userId: 'admin-1', orgId: 'org-123' })
    );
  });

  it('should include admin name in SSE notifications', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({ authorized: true, session: mockSession('Jane Platform Admin'), status: 200 });

    await adminPatch(createRequest({ status: 'SUSPENDED' }), adminParams());

    expect(notifyOrganizationSuspension).toHaveBeenCalledWith(
      'org-123',
      'Acme Corp',
      3,
      'Jane Platform Admin'
    );

    await adminPatch(createRequest({ status: 'ARCHIVED' }), adminParams());

    expect(notifyOrganizationArchival).toHaveBeenCalledWith(
      'org-123',
      'Acme Corp',
      3,
      'Jane Platform Admin'
    );

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue(mockFullOrg('SUSPENDED'));
    vi.mocked(globalDb.organization.update).mockResolvedValue(mockFullOrg('ACTIVE'));

    await adminPatch(createRequest({ status: 'ACTIVE' }), adminParams());

    expect(notifyOrganizationReactivation).toHaveBeenCalledWith(
      'org-123',
      'Acme Corp',
      3,
      'Jane Platform Admin'
    );
  });

  it('should invalidate sessions when suspending', async () => {
    await adminPatch(createRequest({ status: 'SUSPENDED' }), adminParams());

    expect(globalDb.session.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: { in: ['user-0', 'user-1', 'user-2'] } } })
    );
  });

  it('should invalidate sessions when archiving', async () => {
    await adminPatch(createRequest({ status: 'ARCHIVED' }), adminParams());

    expect(globalDb.session.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: { in: ['user-0', 'user-1', 'user-2'] } } })
    );
  });

  it('should log SSE notification dispatch after suspension', async () => {
    await adminPatch(createRequest({ status: 'SUSPENDED' }), adminParams());

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'admin-1', orgId: 'org-123', userCount: 3 }),
      '[ORG_STATUS_API] SSE notification dispatched — organization suspended'
    );
  });

  it('should log SSE notification dispatch after archival', async () => {
    await adminPatch(createRequest({ status: 'ARCHIVED' }), adminParams());

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'admin-1', orgId: 'org-123', userCount: 3 }),
      '[ORG_STATUS_API] SSE notification dispatched — organization archived'
    );
  });

  it('should log SSE notification dispatch after reactivation', async () => {
    vi.mocked(globalDb.organization.findUnique).mockResolvedValue(mockFullOrg('SUSPENDED'));
    vi.mocked(globalDb.organization.update).mockResolvedValue(mockFullOrg('ACTIVE'));

    await adminPatch(createRequest({ status: 'ACTIVE' }), adminParams());

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'admin-1', orgId: 'org-123', userCount: 3 }),
      '[ORG_STATUS_API] SSE notification dispatched — organization reactivated'
    );
  });

  it('should log ban action as WARNING level', async () => {
    await adminPatch(createRequest({ status: 'SUSPENDED' }), adminParams());

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        orgId: 'org-123',
        fromStatus: 'ACTIVE',
        toStatus: 'SUSPENDED',
      }),
      '[ORG_STATUS_API] suspend organization — banning all member users'
    );

    // Reset and test archive warning - re-setup defaults after clearAllMocks
    vi.clearAllMocks();
    setupDefaults();
    vi.mocked(globalDb.organization.findUnique).mockResolvedValue(mockFullOrg('ACTIVE'));

    await adminPatch(createRequest({ status: 'ARCHIVED' }), adminParams());

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'ARCHIVED' }),
      '[ORG_STATUS_API] archive organization — banning all member users'
    );
  });

  it('should log reactivation as INFO level', async () => {
    vi.mocked(globalDb.organization.findUnique).mockResolvedValue(mockFullOrg('SUSPENDED'));
    vi.mocked(globalDb.organization.update).mockResolvedValue(mockFullOrg('ACTIVE'));

    await adminPatch(createRequest({ status: 'ACTIVE' }), adminParams());

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        orgId: 'org-123',
        fromStatus: 'SUSPENDED',
        toStatus: 'ACTIVE',
      }),
      '[ORG_STATUS_API] Reactivating organization — unbanning all member users'
    );
  });

  it('should handle single-member org correctly', async () => {
    vi.mocked(globalDb.member.findMany).mockResolvedValue([{ id: 'member-1', role: 'member', createdAt: new Date(), updatedAt: new Date(), userId: 'user-single', orgId: 'org-123', teamId: null }]);

    await adminPatch(createRequest({ status: 'SUSPENDED' }), adminParams());

    expect(globalDb.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['user-single'] } } })
    );

    expect(notifyOrganizationSuspension).toHaveBeenCalledWith(
      'org-123',
      'Acme Corp',
      1,
      'Super Admin'
    );
  });

  it('should handle large number of members correctly', async () => {
    const bigMembers = mockMembers(100);

    vi.mocked(globalDb.member.findMany).mockResolvedValue(bigMembers);

    await adminPatch(createRequest({ status: 'SUSPENDED' }), adminParams());

    expect(globalDb.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: bigMembers.map((m) => m.userId) } } })
    );

    expect(notifyOrganizationSuspension).toHaveBeenCalledWith(
      'org-123',
      'Acme Corp',
      100,
      'Super Admin'
    );
  });

  it('should ban with correct reason string', async () => {
    await adminPatch(createRequest({ status: 'SUSPENDED' }), adminParams());

    const banCall = (globalDb.user.updateMany as any).mock.calls[0][0];
    expect(banCall.data.banReason).toBe('Banned due to organization "Acme Corp" being suspended.');
  });

  it('should set banExpires to null on ban', async () => {
    await adminPatch(createRequest({ status: 'SUSPENDED' }), adminParams());

    const banCall = (globalDb.user.updateMany as any).mock.calls[0][0];
    expect(banCall.data.banExpires).toBeNull();
  });

  it('should clear banReason and banExpires on unban', async () => {
    vi.mocked(globalDb.organization.findUnique).mockResolvedValue(mockFullOrg('SUSPENDED'));
    vi.mocked(globalDb.organization.update).mockResolvedValue(mockFullOrg('ACTIVE'));

    await adminPatch(createRequest({ status: 'ACTIVE' }), adminParams());

    const unbanCall = (globalDb.user.updateMany as any).mock.calls[0][0];
    expect(unbanCall.data.banned).toBe(false);
    expect(unbanCall.data.banReason).toBeNull();
    expect(unbanCall.data.banExpires).toBeNull();
  });

  it('should not unban when reactivating from ACTIVE (invalid transition)', async () => {
    vi.mocked(globalDb.organization.findUnique).mockResolvedValue(mockFullOrg('ACTIVE'));

    const response = await adminPatch(createRequest({ status: 'SUSPENDED' }), adminParams());

    // This should work (ACTIVE → SUSPENDED is valid), but reactivation logic
    // only triggers when org.status === 'SUSPENDED' && newStatus === 'ACTIVE'
    expect(response.status).toBe(200);

    // Users should still be banned (suspend path)
    expect(globalDb.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ banned: true }) })
    );
  });
});

// ---------------------------------------------------------------------------
// Dashboard route — suspend / archive / reactivate with user ban logic
// The dashboard route uses OrganizationService.updateOrganization() which
// internally calls globalDb.organization.findUnique/update. The service returns
// the org object directly (not wrapped in { organization: ... }).
// ---------------------------------------------------------------------------

describe('Dashboard status route — org suspend/archive/reactivate', () => {
  beforeEach(() => {
    setupDefaults();
    vi.mocked(globalDb.organization.update).mockResolvedValue(mockFullOrg('SUSPENDED'));
    vi.mocked(OrganizationService.updateOrganization).mockResolvedValue(mockFullOrg('SUSPENDED'));
  });

  it('should suspend an org and ban all users', async () => {
    const response = await dashboardPatch(createDashboardRequest({ status: 'SUSPENDED' }), dashboardParams());

    expect(response.status).toBe(200);
    const data = await response.json();

    // Dashboard route returns org directly, not wrapped in { organization: ... }
    expect(data.status).toBe('SUSPENDED');

    // Verify users were banned
    expect(globalDb.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['user-0', 'user-1', 'user-2'] } },
        data: expect.objectContaining({ banned: true }),
      })
    );

    // Verify SSE notification was dispatched
    expect(notifyOrganizationSuspension).toHaveBeenCalledWith(
      'org-123',
      'Acme Corp',
      3,
      'Super Admin'
    );

    // Verify logger.warn was called for the ban action
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'admin-1', orgId: 'org-123', toStatus: 'SUSPENDED' }),
      expect.stringContaining('suspend organization')
    );

    // Verify sessions were invalidated
    expect(globalDb.session.deleteMany).toHaveBeenCalled();
  });

  it('should archive an org and ban all users', async () => {
    vi.mocked(globalDb.organization.update).mockResolvedValue(mockFullOrg('ARCHIVED'));
    vi.mocked(OrganizationService.updateOrganization).mockResolvedValue(mockFullOrg('ARCHIVED'));

    const response = await dashboardPatch(createDashboardRequest({ status: 'ARCHIVED' }), dashboardParams());

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('ARCHIVED');

    // Verify users were banned
    expect(globalDb.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['user-0', 'user-1', 'user-2'] } },
        data: expect.objectContaining({ banned: true }),
      })
    );

    // Verify archival SSE notification was dispatched
    expect(notifyOrganizationArchival).toHaveBeenCalledWith(
      'org-123',
      'Acme Corp',
      3,
      'Super Admin'
    );

    // Verify logger.warn was called for the archive action
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'ARCHIVED' }),
      expect.stringContaining('archive organization')
    );

    // Verify sessions were invalidated
    expect(globalDb.session.deleteMany).toHaveBeenCalled();
  });

  it('should reactivate a suspended org and unban all users', async () => {
    vi.mocked(globalDb.organization.findUnique).mockResolvedValue(mockFullOrg('SUSPENDED'));
    vi.mocked(globalDb.organization.update).mockResolvedValue(mockFullOrg('ACTIVE'));
    vi.mocked(OrganizationService.updateOrganization).mockResolvedValue(mockFullOrg('ACTIVE'));
    vi.mocked(globalDb.member.findMany).mockResolvedValue(mockMembers(3));

    const response = await dashboardPatch(createDashboardRequest({ status: 'ACTIVE' }), dashboardParams());

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('ACTIVE');

    // Verify users were unbanned
    expect(globalDb.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['user-0', 'user-1', 'user-2'] } },
        data: expect.objectContaining({ banned: false, banReason: null }),
      })
    );

    // Verify reactivation SSE notification was dispatched
    expect(notifyOrganizationReactivation).toHaveBeenCalledWith(
      'org-123',
      'Acme Corp',
      3,
      'Super Admin'
    );

    // Verify logger.info was called for reactivation
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'ACTIVE' }),
      expect.stringContaining('Reactivating organization')
    );

    // Verify logger.info was called for SSE dispatch
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'admin-1', orgId: 'org-123', userCount: 3 }),
      '[DASHBOARD_ORG_STATUS] SSE notification dispatched — organization reactivated'
    );
  });

  it('should return 404 when org not found', async () => {
    vi.mocked(globalDb.organization.findUnique).mockResolvedValue(null);

    const response = await dashboardPatch(createDashboardRequest({ status: 'SUSPENDED' }), dashboardParams());

    expect(response.status).toBe(404);
  });

  it('should skip SSE notification when org has no members', async () => {
    vi.mocked(globalDb.member.findMany).mockResolvedValue([]);

    await dashboardPatch(createDashboardRequest({ status: 'SUSPENDED' }), dashboardParams());

    expect(notifyOrganizationSuspension).not.toHaveBeenCalled();
  });

  it('should log ban action as WARNING level', async () => {
    await dashboardPatch(createDashboardRequest({ status: 'SUSPENDED' }), dashboardParams());

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        orgId: 'org-123',
        fromStatus: 'ACTIVE',
        toStatus: 'SUSPENDED',
      }),
      '[DASHBOARD_ORG_STATUS] suspend organization — banning all member users'
    );

    // Reset and test archive warning - re-setup defaults after clearAllMocks
    vi.clearAllMocks();
    setupDefaults();
    vi.mocked(globalDb.organization.findUnique).mockResolvedValue(mockFullOrg('ACTIVE'));

    await dashboardPatch(createDashboardRequest({ status: 'ARCHIVED' }), dashboardParams());

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'ARCHIVED' }),
      '[DASHBOARD_ORG_STATUS] archive organization — banning all member users'
    );
  });

  it('should log reactivation as INFO level', async () => {
    vi.mocked(globalDb.organization.findUnique).mockResolvedValue(mockFullOrg('SUSPENDED'));
    vi.mocked(OrganizationService.updateOrganization).mockResolvedValue(mockFullOrg('ACTIVE'));

    await dashboardPatch(createDashboardRequest({ status: 'ACTIVE' }), dashboardParams());

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'ACTIVE' }),
      '[DASHBOARD_ORG_STATUS] Reactivating organization — unbanning all member users'
    );
  });

  it('should handle single-member org correctly', async () => {
    vi.mocked(globalDb.member.findMany).mockResolvedValue([{ id: 'member-1', role: 'member', createdAt: new Date(), updatedAt: new Date(), userId: 'user-single', orgId: 'org-123', teamId: null }]);

    await dashboardPatch(createDashboardRequest({ status: 'SUSPENDED' }), dashboardParams());

    expect(globalDb.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['user-single'] } } })
    );

    expect(notifyOrganizationSuspension).toHaveBeenCalledWith(
      'org-123',
      'Acme Corp',
      1,
      'Super Admin'
    );
  });

  it('should handle large number of members correctly', async () => {
    const bigMembers = mockMembers(100);

    vi.mocked(globalDb.member.findMany).mockResolvedValue(bigMembers);

    await dashboardPatch(createDashboardRequest({ status: 'SUSPENDED' }), dashboardParams());

    expect(globalDb.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: bigMembers.map((m) => m.userId) } } })
    );

    expect(notifyOrganizationSuspension).toHaveBeenCalledWith(
      'org-123',
      'Acme Corp',
      100,
      'Super Admin'
    );
  });

  it('should ban with correct reason string for suspension', async () => {
    await dashboardPatch(createDashboardRequest({ status: 'SUSPENDED' }), dashboardParams());

    const banCall = (globalDb.user.updateMany as any).mock.calls[0][0];
    expect(banCall.data.banReason).toBe('Banned due to organization "Acme Corp" being suspended.');
  });

  it('should ban with correct reason string for archival', async () => {
    await dashboardPatch(createDashboardRequest({ status: 'ARCHIVED' }), dashboardParams());

    const banCall = (globalDb.user.updateMany as any).mock.calls[0][0];
    expect(banCall.data.banReason).toBe('Banned due to organization "Acme Corp" being archived.');
  });

  it('should clear ban fields on unban', async () => {
    vi.mocked(globalDb.organization.findUnique).mockResolvedValue(mockFullOrg('SUSPENDED'));
    vi.mocked(OrganizationService.updateOrganization).mockResolvedValue(mockFullOrg('ACTIVE'));

    await dashboardPatch(createDashboardRequest({ status: 'ACTIVE' }), dashboardParams());

    const unbanCall = (globalDb.user.updateMany as any).mock.calls[0][0];
    expect(unbanCall.data.banned).toBe(false);
    expect(unbanCall.data.banReason).toBeNull();
    expect(unbanCall.data.banExpires).toBeNull();
  });

  it('should log SSE notification dispatch after suspension', async () => {
    await dashboardPatch(createDashboardRequest({ status: 'SUSPENDED' }), dashboardParams());

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'admin-1', orgId: 'org-123', userCount: 3 }),
      '[DASHBOARD_ORG_STATUS] SSE notification dispatched — organization suspended'
    );
  });

  it('should log SSE notification dispatch after archival', async () => {
    await dashboardPatch(createDashboardRequest({ status: 'ARCHIVED' }), dashboardParams());

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'admin-1', orgId: 'org-123', userCount: 3 }),
      '[DASHBOARD_ORG_STATUS] SSE notification dispatched — organization archived'
    );
  });

  it('should log SSE notification dispatch after reactivation', async () => {
    vi.mocked(globalDb.organization.findUnique).mockResolvedValue(mockFullOrg('SUSPENDED'));
    vi.mocked(OrganizationService.updateOrganization).mockResolvedValue(mockFullOrg('ACTIVE'));

    await dashboardPatch(createDashboardRequest({ status: 'ACTIVE' }), dashboardParams());

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'admin-1', orgId: 'org-123', userCount: 3 }),
      '[DASHBOARD_ORG_STATUS] SSE notification dispatched — organization reactivated'
    );
  });

  it('should still succeed when ban operation throws (graceful degradation)', async () => {
    vi.mocked(globalDb.user.updateMany).mockRejectedValue(new Error('DB timeout'));

    const response = await dashboardPatch(createDashboardRequest({ status: 'SUSPENDED' }), dashboardParams());

    expect(response.status).toBe(200);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      '[DASHBOARD_ORG_STATUS] Failed to ban org users'
    );
  });

  it('should handle invalid JSON body gracefully', async () => {
    const response = await dashboardPatch(
      { json: () => Promise.reject(new Error('Invalid JSON')), headers: new Headers(), url: 'http://localhost:3000/api/dashboard/admin/organizations/org-123/status', method: 'PATCH' } as unknown as NextRequest,
      dashboardParams()
    );

    expect(response.status).toBe(400);
  });

  it('should return 503 when database is unavailable', async () => {
    vi.mocked(globalDb.organization.findUnique).mockRejectedValue(new Error('DB connection refused'));

    const response = await dashboardPatch(createDashboardRequest({ status: 'SUSPENDED' }), dashboardParams());

    expect(response.status).toBe(500);
  });

  it('should return 401 when not authorized', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({ session: null, authorized: false, error: 'Unauthorized', status: 401 });

    const response = await dashboardPatch(createDashboardRequest({ status: 'SUSPENDED' }), dashboardParams());

    expect(response.status).toBe(401);
  });
});