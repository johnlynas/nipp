/**
 * Unit tests for notifyOrganizationOperation — SSE push helper for admin
 * organization management events (create / update / archive).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationPriority, NotificationScope } from '@prisma/client';
import { notifyOrganizationOperation } from '@/lib/notification-push';

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

describe('notifyOrganizationOperation', () => {
  it('pushes INFO priority success notification on create', async () => {
    await notifyOrganizationOperation(
      'create',
      'Organization "Acme" (org-1)',
      true,
      undefined,
      'org-1'
    );

    expect(notificationCreate).toHaveBeenCalledTimes(1);
    const data = notificationCreate.mock.calls[0][0].data;
    expect(data.title).toBe('Organization created');
    expect(data.message).toContain('"Acme"');
    expect(data.message).toContain('created successfully');
    expect(data.priority).toBe(NotificationPriority.INFO);
    expect(data.scope).toBe(NotificationScope.GLOBAL);
    expect(data.source).toBe('admin:organization-management');
    expect(data.organizationId).toBe('org-1'); // created org id passed through
  });

  it('pushes ERROR priority notification on create failure', async () => {
    await notifyOrganizationOperation(
      'create',
      'Organization "Acme"',
      false,
      'An organization with this name already exists'
    );

    const data = notificationCreate.mock.calls[0][0].data;
    expect(data.title).toBe('Failed to create organization');
    expect(data.message).toContain('An organization with this name already exists');
    expect(data.priority).toBe(NotificationPriority.ERROR);
    expect(data.scope).toBe(NotificationScope.GLOBAL);
  });

  it.each([
    ['update', 'Organization updated', 'Failed to update organization'],
    ['archive', 'Organization archived', 'Failed to archive organization'],
  ] as const)('%s: success and failure titles', async (op, successTitle, failureTitle) => {
    await notifyOrganizationOperation(op, 'Organization "Acme" (org-1)', true, undefined, 'org-1');
    expect(notificationCreate.mock.calls[0][0].data.title).toBe(successTitle);

    await notifyOrganizationOperation(op, 'org-2', false, 'boom');
    const calls = notificationCreate.mock.calls;
    expect(calls[1][0].data.title).toBe(failureTitle);
    expect(calls[1][0].data.priority).toBe(NotificationPriority.ERROR);
    expect(calls[1][0].data.message).toContain('boom');
  });

  it('falls back to a generic message when no error details are given', async () => {
    await notifyOrganizationOperation('archive', 'org-9', false, undefined);
    const data = notificationCreate.mock.calls[0][0].data;
    expect(data.message).toContain('No error details available');
  });

  it('swallows persistence failures (notification DB must not break the route)', async () => {
    notificationCreate.mockRejectedValueOnce(new Error('db down'));
    // Must not throw
    await expect(
      notifyOrganizationOperation('update', 'Organization "Acme" (org-1)', true, undefined, 'org-1')
    ).resolves.toBeUndefined();
  });
});
