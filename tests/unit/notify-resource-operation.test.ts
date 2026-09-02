/**
 * Unit tests for notifyResourceOperation — SSE push helper for admin
 * resource-management events (create / update / delete).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationPriority, NotificationScope } from '@prisma/client';
import { notifyResourceOperation } from '@/lib/notification-push';

// Mock the Prisma client — notification-push persists via globalDb.notification and
// resolves org names via globalDb.organization.
const notificationCreate = vi.fn().mockResolvedValue({ id: 'notif-row-1' });
const notificationFindFirst = vi.fn().mockResolvedValue(null); // no dedup hit

vi.mock('@/lib/global-db', () => ({
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

describe('notifyResourceOperation', () => {
  it('pushes INFO priority success notification on create', async () => {
    await notifyResourceOperation(
      'create',
      'Resource "users"',
      true
    );

    expect(notificationCreate).toHaveBeenCalledTimes(1);
    const data = notificationCreate.mock.calls[0][0].data;
    expect(data.title).toBe('Resource created');
    expect(data.message).toContain('"users"');
    expect(data.message).toContain('created successfully');
    expect(data.priority).toBe(NotificationPriority.INFO);
    expect(data.scope).toBe(NotificationScope.GLOBAL);
    expect(data.source).toBe('admin:resource-management');
    expect(data.organizationId).toBeNull(); // resources are global, not org-scoped
  });

  it('pushes ERROR priority notification on create failure', async () => {
    await notifyResourceOperation(
      'create',
      'Resource "users"',
      false,
      'A resource with the name "users" already exists'
    );

    const data = notificationCreate.mock.calls[0][0].data;
    expect(data.title).toBe('Failed to create resource');
    expect(data.message).toContain('already exists');
    expect(data.priority).toBe(NotificationPriority.ERROR);
    expect(data.scope).toBe(NotificationScope.GLOBAL);
  });

  it.each([
    ['update', 'Resource updated', 'Failed to update resource'],
    ['delete', 'Resource deleted', 'Failed to delete resource'],
  ] as const)('%s: success and failure titles', async (op, successTitle, failureTitle) => {
    await notifyResourceOperation(op, 'Resource "users" (res-1)', true);
    expect(notificationCreate.mock.calls[0][0].data.title).toBe(successTitle);

    await notifyResourceOperation(op, 'res-2', false, 'boom');
    const calls = notificationCreate.mock.calls;
    expect(calls[1][0].data.title).toBe(failureTitle);
    expect(calls[1][0].data.priority).toBe(NotificationPriority.ERROR);
    expect(calls[1][0].data.message).toContain('boom');
  });

  it('falls back to a generic message when no error details are given', async () => {
    await notifyResourceOperation('delete', 'res-9', false, undefined);
    const data = notificationCreate.mock.calls[0][0].data;
    expect(data.message).toContain('No error details available');
  });

  it('swallows persistence failures (notification DB must not break the route)', async () => {
    notificationCreate.mockRejectedValueOnce(new Error('db down'));
    // Must not throw
    await expect(
      notifyResourceOperation('update', 'Resource "users" (res-1)', true)
    ).resolves.toBeUndefined();
  });
});
