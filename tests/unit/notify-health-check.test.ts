/**
 * Unit tests for notifyHealthCheck — SSE push helper for system
 * health check events (database / cache / pgbouncer).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationPriority, NotificationScope } from '@prisma/client';
import { notifyHealthCheck, resetNotificationDedupIndex } from '@/lib/notification-push';

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
  resetNotificationDedupIndex();
});

describe('notifyHealthCheck', () => {
  it('pushes INFO priority notification when a service is healthy', async () => {
    await notifyHealthCheck('database', true, 'org-1');

    expect(notificationCreate).toHaveBeenCalledTimes(1);
    const data = notificationCreate.mock.calls[0][0].data;
    expect(data.title).toBe('Database health check passed');
    expect(data.message).toContain('Database health check passed');
    expect(data.message).toContain('Service is responsive');
    expect(data.priority).toBe(NotificationPriority.INFO);
    expect(data.scope).toBe(NotificationScope.GLOBAL);
    expect(data.source).toBe('health-check:database');
    expect(data.organizationId).toBe('org-1');
  });

  it('pushes CRITICAL priority notification when a service is unhealthy', async () => {
    await notifyHealthCheck('database', false, 'org-1');

    const data = notificationCreate.mock.calls[0][0].data;
    expect(data.title).toBe('Database health check failed');
    expect(data.message).toContain('unreachable');
    expect(data.priority).toBe(NotificationPriority.CRITICAL);
    expect(data.scope).toBe(NotificationScope.GLOBAL);
  });

  it.each([
    ['cache', 'Cache health check', 'health-check:cache'],
    ['pgbouncer', 'Connection pool health check', 'health-check:pgbouncer'],
  ] as const)('%s: pass and fail titles with correct source', async (service, title, source) => {
    await notifyHealthCheck(service, true);
    expect(notificationCreate.mock.calls[0][0].data.title).toBe(`${title} passed`);
    expect(notificationCreate.mock.calls[0][0].data.source).toBe(source);
    expect(notificationCreate.mock.calls[0][0].data.priority).toBe(NotificationPriority.INFO);

    await notifyHealthCheck(service, false);
    const calls = notificationCreate.mock.calls;
    expect(calls[1][0].data.title).toBe(`${title} failed`);
    expect(calls[1][0].data.priority).toBe(NotificationPriority.CRITICAL);
  });

  it('passes organizationId as null when no platform org is known', async () => {
    await notifyHealthCheck('cache', true);
    const data = notificationCreate.mock.calls[0][0].data;
    expect(data.organizationId).toBeNull();
  });

  it('deduplicates concurrent identical pushes (boot-time health race)', async () => {
    // Simulates two /api/health callers racing on boot — both read
    // previousState === null and fire the same "first healthy check" events.
    await Promise.all([
      notifyHealthCheck('database', true, 'org-1'),
      notifyHealthCheck('database', true, 'org-1'),
      notifyHealthCheck('cache', true, 'org-1'),
      notifyHealthCheck('pgbouncer', true, 'org-1'),
    ]);

    // The two identical db pushes collapse to one; each distinct service
    // still notifies exactly once.
    expect(notificationCreate).toHaveBeenCalledTimes(3);
    const sources = notificationCreate.mock.calls.map((c) => c[0].data.source).sort();
    expect(sources).toEqual([
      'health-check:cache',
      'health-check:database',
      'health-check:pgbouncer',
    ]);
  });

  it('does not dedup notifications that differ only in org scope', async () => {
    await notifyHealthCheck('cache', true, 'org-1');
    await notifyHealthCheck('cache', true, 'org-2');
    expect(notificationCreate).toHaveBeenCalledTimes(2);
  });

  it('swallows persistence failures (notification DB must not break the health route)', async () => {
    notificationCreate.mockRejectedValueOnce(new Error('db down'));
    // Must not throw
    await expect(notifyHealthCheck('pgbouncer', false)).resolves.toBeUndefined();
  });
});
