/**
 * Unit tests for notifyPermissionOperation — SSE push helper for admin
 * permission-management events (create / update / delete).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationPriority, NotificationScope } from '@prisma/client';
import { notifyPermissionOperation } from '@/lib/notification-push';

// Mock the Prisma client — notification-push persists via globalDb.notification and
// resolves org names via globalDb.organization.
const notificationCreate = vi.fn().mockResolvedValue({ id: 'notif-row-1' });
const notificationFindFirst = vi.fn().mockResolvedValue(null); // no dedup hit

vi.mock('@/lib/tenant-db', () => ({
  default: {
    notification: {
      create: (...args: unknown[]) => notificationCreate(...args),
      findFirst: (...args: unknown[]) => notificationFindFirst(...args),
    },
    organization: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));

// notification-push imports the enums at module scope; keep the real client enums.
beforeEach(() => {
  notificationCreate.mockClear();
});

describe('notifyPermissionOperation', () => {
  it('pushes INFO priority success notification on create', async () => {
    await notifyPermissionOperation(
      'create',
      'Permission "users:create"',
      true
    );

    expect(notificationCreate).toHaveBeenCalledTimes(1);
    const data = notificationCreate.mock.calls[0][0].data;
    expect(data.title).toBe('Permission created');
    expect(data.message).toContain('"users:create"');
    expect(data.message).toContain('created successfully');
    expect(data.priority).toBe(NotificationPriority.INFO);
    expect(data.scope).toBe(NotificationScope.GLOBAL);
    expect(data.source).toBe('admin:permission-management');
    expect(data.organizationId).toBeNull(); // permissions are global, not org-scoped
  });

  it('pushes ERROR priority notification on create failure', async () => {
    await notifyPermissionOperation(
      'create',
      'Permission "users:create"',
      false,
      'Failed to create permission'
    );

    const data = notificationCreate.mock.calls[0][0].data;
    expect(data.title).toBe('Failed to create permission');
    expect(data.message).toContain('Failed to create permission');
    expect(data.priority).toBe(NotificationPriority.ERROR);
    expect(data.scope).toBe(NotificationScope.GLOBAL);
  });

  it.each([
    ['update', 'Permission updated', 'Failed to update permission'],
    ['delete', 'Permission deleted', 'Failed to delete permission'],
  ] as const)('%s: success and failure titles', async (op, successTitle, failureTitle) => {
    await notifyPermissionOperation(op, 'Permission "users:create" (perm-1)', true);
    expect(notificationCreate.mock.calls[0][0].data.title).toBe(successTitle);

    await notifyPermissionOperation(op, 'perm-2', false, 'boom');
    const calls = notificationCreate.mock.calls;
    expect(calls[1][0].data.title).toBe(failureTitle);
    expect(calls[1][0].data.priority).toBe(NotificationPriority.ERROR);
    expect(calls[1][0].data.message).toContain('boom');
  });

  it('falls back to a generic message when no error details are given', async () => {
    await notifyPermissionOperation('delete', 'perm-9', false, undefined);
    const data = notificationCreate.mock.calls[0][0].data;
    expect(data.message).toContain('No error details available');
  });

  it('swallows persistence failures (notification DB must not break the route)', async () => {
    notificationCreate.mockRejectedValueOnce(new Error('db down'));
    // Must not throw
    await expect(
      notifyPermissionOperation('update', 'Permission "users:create" (perm-1)', true)
    ).resolves.toBeUndefined();
  });
});
