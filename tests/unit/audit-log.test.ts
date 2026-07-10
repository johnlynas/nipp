/**
 * Unit test: recordAuditLog() inserts the correct payload into the DB.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/global-db', () => ({
  default: {
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: 'log1' }),
    },
  },
}));

describe('recordAuditLog()', () => {
  it('should insert the correct payload into the database', async () => {
    const { recordAuditLog } = await import('@/lib/audit-log');

    await recordAuditLog({
      userId: 'user-123',
      userName: 'Test Admin',
      action: 'organization.created',
      resourceType: 'Organization',
      resourceId: 'org-456',
      organizationId: null,
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
      success: true,
      metadata: { name: 'Test Org' },
    });

    const { default: globalDb } = await import('@/lib/global-db');
    expect(globalDb.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-123',
        userName: 'Test Admin',
        action: 'organization.created',
        resourceType: 'Organization',
        resourceId: 'org-456',
        organizationId: null,
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
        success: true,
        metadata: { name: 'Test Org' },
      },
    });
  });

  it('should handle missing optional fields', async () => {
    const { recordAuditLog } = await import('@/lib/audit-log');

    await recordAuditLog({
      action: 'test.action',
      resourceType: 'Test',
      success: true,
    });

    const { default: globalDb } = await import('@/lib/global-db');
    expect(globalDb.auditLog.create).toHaveBeenCalled();
  });

  it('should not throw when DB fails (graceful degradation)', async () => {
    vi.mocked((await import('@/lib/global-db')).default.auditLog.create).mockRejectedValueOnce(new Error('DB error'));

    const { recordAuditLog } = await import('@/lib/audit-log');

    // Should not throw
    await expect(recordAuditLog({
      action: 'test',
      resourceType: 'Test',
      success: true,
    })).resolves.toBeUndefined();
  });
});
