/**
 * Unit tests for notifyRoleOperation — SSE push helper for admin role
 * management events (create / update / delete).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationPriority, NotificationScope } from '@prisma/client';
import { notifyRoleOperation } from '@/lib/notification-push';

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

describe('notifyRoleOperation', () => {
  it('pushes INFO priority success notification on create', async () => {
    await notifyRoleOperation(
      'create',
      'Role "Manager"',
      true,
      undefined,
      'org-1'
    );

    expect(notificationCreate).toHaveBeenCalledTimes(1);
    const data = notificationCreate.mock.calls[0][0].data;
    expect(data.title).toBe('Role created');
    expect(data.message).toContain('"Manager"');
    expect(data.message).toContain('created successfully');
    expect(data.priority).toBe(NotificationPriority.INFO);
    expect(data.scope).toBe(NotificationScope.GLOBAL);
    expect(data.source).toBe('admin:role-management');
    expect(data.organizationId).toBe('org-1'); // role's org id passed through
  });

  it('pushes ERROR priority notification on create failure', async () => {
    await notifyRoleOperation(
      'create',
      'Role "Manager"',
      false,
      'Failed to create role',
      'org-1'
    );

    const data = notificationCreate.mock.calls[0][0].data;
    expect(data.title).toBe('Failed to create role');
    expect(data.message).toContain('Failed to create role');
    expect(data.priority).toBe(NotificationPriority.ERROR);
    expect(data.scope).toBe(NotificationScope.GLOBAL);
  });

  it.each([
    ['update', 'Role updated', 'Failed to update role'],
    ['delete', 'Role deleted', 'Failed to delete role'],
  ] as const)('%s: success and failure titles', async (op, successTitle, failureTitle) => {
    await notifyRoleOperation(op, 'Role "Manager" (role-1)', true, undefined, 'org-1');
    expect(notificationCreate.mock.calls[0][0].data.title).toBe(successTitle);

    await notifyRoleOperation(op, 'role-2', false, 'boom');
    const calls = notificationCreate.mock.calls;
    expect(calls[1][0].data.title).toBe(failureTitle);
    expect(calls[1][0].data.priority).toBe(NotificationPriority.ERROR);
    expect(calls[1][0].data.message).toContain('boom');
  });

  it('falls back to a generic message when no error details are given', async () => {
    await notifyRoleOperation('delete', 'role-9', false, undefined);
    const data = notificationCreate.mock.calls[0][0].data;
    expect(data.message).toContain('No error details available');
  });

  it('swallows persistence failures (notification DB must not break the route)', async () => {
    notificationCreate.mockRejectedValueOnce(new Error('db down'));
    // Must not throw
    await expect(
      notifyRoleOperation('update', 'Role "Manager" (role-1)', true, undefined, 'org-1')
    ).resolves.toBeUndefined();
  });
});
