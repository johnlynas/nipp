/**
 * Integration tests — rate-limit CRITICAL reporting.
 *
 * Every check*RateLimit() function (used by all ~73 route-level throttle
 * points: auth brute-force, payload-key issuance/revoke, admin writes,
 * calendar CRUD) routes through `reportThrottle()`. On a throttle it must
 * surface the event as a CRITICAL signal on BOTH channels:
 *
 *   1. a **critical-level** pino log record (logger.critical), and
 *   2. a **CRITICAL-priority GLOBAL** SSE notification, persisted to the
 *      Notification table via notifyRateLimited() → pushNotification().
 *
 * We drive the REAL limiter functions and mock only the two sinks:
 *   - @/lib/logger    → spy on logger.critical / logger.error
 *   - @/lib/global-db → notification.findFirst/create + organization.findUnique
 *
 * @/lib/notification-push is intentionally NOT mocked, so notifyRateLimited()
 * executes its real persist path and we can assert the stored record's
 * priority / scope / source are the CRITICAL ones.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationPriority, NotificationScope } from '@prisma/client';

// ---------------------------------------------------------------------------
// Hoisted mock sinks — must exist before the vi.mock() factories evaluate.
// ---------------------------------------------------------------------------

const m = vi.hoisted(() => ({
  critical: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
  notificationCreate: vi.fn().mockResolvedValue({ id: 'notif-rate-limited' }),
  notificationFindFirst: vi.fn().mockResolvedValue(null), // no DB dedup hit
  organizationFindUnique: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    critical: m.critical,
    error: m.error,
    warn: m.warn,
    info: m.info,
    debug: m.debug,
    child: m.child,
  },
  createChildLogger: vi.fn(),
  redactLogObject: (x: unknown) => x,
}));

vi.mock('@/lib/global-db', () => ({
  default: {
    notification: {
      findFirst: m.notificationFindFirst,
      create: m.notificationCreate,
     },
    organization: {
      findUnique: m.organizationFindUnique,
     },
   },
}));

// ---------------------------------------------------------------------------
// Real limiter under test — same code path as every route throttle site.
// ---------------------------------------------------------------------------

import {
  checkRateLimit,
  resetRateLimitStore,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW,
  checkRevokeRateLimit,
  resetRevokeRateLimitStore,
  REVOKE_RATE_LIMIT_MAX,
  REVOKE_RATE_LIMIT_WINDOW,
  checkAuthRateLimit,
  resetAuthRateLimitStore,
  AUTH_RATE_LIMIT_MAX,
  AUTH_RATE_LIMIT_WINDOW,
  checkAdminRateLimit,
  resetAdminRateLimitStore,
  ADMIN_RATE_LIMIT_MAX,
  ADMIN_RATE_LIMIT_WINDOW,
  checkCalendarRateLimit,
  resetCalendarRateLimitStore,
  CALENDAR_RATE_LIMIT_MAX,
  CALENDAR_RATE_LIMIT_WINDOW,
} from '@/lib/rate-limiter';
import { resetNotificationDedupIndex } from '@/lib/notification-push';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * reportThrottle fires notifyRateLimited() fire-and-forget, so flush the
 * microtask/promise queue before asserting on the persisted notification.
 * setTimeout (a macrotask) drains the whole nested-await chain.
 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

/** First reportThrottle call (if any) — its logger.critical context object. */
const criticalContext = (): Record<string, unknown> | undefined => {
  if (m.critical.mock.calls.length === 0) return undefined;
  return m.critical.mock.calls[0][0] as Record<string, unknown>;
};

/** Most recent reportThrottle call — its logger.critical context object. */
const latestCriticalContext = (): Record<string, unknown> | undefined => {
  if (m.critical.mock.calls.length === 0) return undefined;
  return m.critical.mock.calls.at(-1)![0] as Record<string, unknown>;
};

/** The notification persisted by notifyRateLimited() (first call, or undefined). */
const persistedNotification = () => {
  if (m.notificationCreate.mock.calls.length === 0) return undefined;
  return (m.notificationCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
};

/** The most recently persisted notification (or undefined). */
const latestNotification = () => {
  if (m.notificationCreate.mock.calls.length === 0) return undefined;
  return (m.notificationCreate.mock.calls.at(-1)![0] as { data: Record<string, unknown> }).data;
};

/**
 * Run the full throttle-and-report flow for one limiter and assert both
 * channels carry the CRITICAL signal.
 */
async function expectThrottleIsReportedAsCritical(opts: {
  check: (id: string) => boolean;
  reset: () => void;
  clientId: string;
  category: string;
  source: string;
  max: number;
  window: number;
  title: string;
}): Promise<void> {
  const { check, reset, clientId, category, source, max, window, title } = opts;
  reset();

  // Drain the limit (all allowed — no throttle yet).
  for (let i = 0; i < max; i++) {
    expect(check(clientId)).toBe(true);
  }
  expect(m.critical).not.toHaveBeenCalled();
  expect(m.notificationCreate).not.toHaveBeenCalled();

  // The (max + 1)th request is throttled → must report CRITICAL on both channels.
  const throttled = check(clientId);
  expect(throttled).toBe(false);

  // Give the fire-and-forget notifyRateLimited() → pushNotification() time to settle.
  await flush();

  // 1) Critical-level pino log record.
  expect(m.critical).toHaveBeenCalledTimes(1);
  const ctx = criticalContext();
  expect(ctx).toBeDefined();
  expect(ctx!.limiter).toBe('rate-limiter');
  expect(ctx!.category).toBe(category);
  expect(ctx!.clientId).toBe(clientId);
  expect(ctx!.max).toBe(max);
  expect(ctx!.window).toBe(window);
  expect(ctx!.count).toBe(max); // count observed at the throttle moment

  // Critically, it was NOT emitted at a lesser level.
  expect(m.warn).not.toHaveBeenCalled();
  expect(m.error).not.toHaveBeenCalled();

  // 2) CRITICAL-priority GLOBAL SSE notification, persisted with the right source.
  expect(m.notificationCreate).toHaveBeenCalledTimes(1);
  const data = persistedNotification()!;
  expect(data.title).toBe(title);
  expect(data.message).toContain(clientId);
  expect(data.priority).toBe(NotificationPriority.CRITICAL);
  expect(data.scope).toBe(NotificationScope.GLOBAL);
  expect(data.source).toBe(source);
  expect(data.organizationId).toBeNull();
}

beforeEach(() => {
  vi.clearAllMocks();
  m.notificationCreate.mockResolvedValue({ id: 'notif-rate-limited' });
  m.notificationFindFirst.mockResolvedValue(null);
  m.organizationFindUnique.mockResolvedValue(null);
  resetRateLimitStore();
  resetRevokeRateLimitStore();
  resetAuthRateLimitStore();
  resetAdminRateLimitStore();
  resetCalendarRateLimitStore();
  resetNotificationDedupIndex();
});

// ---------------------------------------------------------------------------
// Payload-key issuance (30/min) — session scoped
// ---------------------------------------------------------------------------

describe('checkRateLimit (payload-key issuance) — CRITICAL on throttle', () => {
  it('reports a critical log + CRITICAL SSE alert when throttled', async () => {
    await expectThrottleIsReportedAsCritical({
      check: checkRateLimit,
      reset: resetRateLimitStore,
      clientId: 'session:payload-user',
      category: 'payload-key',
      source: 'rate-limit:payload-key',
      max: RATE_LIMIT_MAX,
      window: RATE_LIMIT_WINDOW,
      title: 'Payload key rate limit exceeded',
     });
  });
});

// ---------------------------------------------------------------------------
// Payload-key revoke (5/min) — strictest session limiter
// ---------------------------------------------------------------------------

describe('checkRevokeRateLimit — CRITICAL on throttle', () => {
  it('reports a critical log + CRITICAL SSE alert when throttled', async () => {
    await expectThrottleIsReportedAsCritical({
      check: checkRevokeRateLimit,
      reset: resetRevokeRateLimitStore,
      clientId: 'session:revoke-user',
      category: 'revoke',
      source: 'rate-limit:revoke',
      max: REVOKE_RATE_LIMIT_MAX,
      window: REVOKE_RATE_LIMIT_WINDOW,
      title: 'Payload key revoke rate limit exceeded',
     });
  });
});

// ---------------------------------------------------------------------------
// Auth brute-force (5/min) — IP scoped
// ---------------------------------------------------------------------------

describe('checkAuthRateLimit — CRITICAL on throttle', () => {
  it('reports a critical log + CRITICAL SSE alert when an IP is throttled', async () => {
    await expectThrottleIsReportedAsCritical({
      check: checkAuthRateLimit,
      reset: resetAuthRateLimitStore,
      clientId: '10.13.37.42',
      category: 'auth',
      source: 'rate-limit:auth',
      max: AUTH_RATE_LIMIT_MAX,
      window: AUTH_RATE_LIMIT_WINDOW,
      title: 'Auth rate limit exceeded',
     });
  });
});

// ---------------------------------------------------------------------------
// Admin writes (30/min) — session scoped
// ---------------------------------------------------------------------------

describe('checkAdminRateLimit — CRITICAL on throttle', () => {
  it('reports a critical log + CRITICAL SSE alert when throttled', async () => {
    await expectThrottleIsReportedAsCritical({
      check: checkAdminRateLimit,
      reset: resetAdminRateLimitStore,
      clientId: 'session:admin-1',
      category: 'admin',
      source: 'rate-limit:admin',
      max: ADMIN_RATE_LIMIT_MAX,
      window: ADMIN_RATE_LIMIT_WINDOW,
      title: 'Admin write rate limit exceeded',
     });
  });
});

// ---------------------------------------------------------------------------
// Calendar CRUD (30/min) — session scoped
// ---------------------------------------------------------------------------

describe('checkCalendarRateLimit — CRITICAL on throttle', () => {
  it('reports a critical log + CRITICAL SSE alert when throttled', async () => {
    await expectThrottleIsReportedAsCritical({
      check: checkCalendarRateLimit,
      reset: resetCalendarRateLimitStore,
      clientId: 'session:calendar-admin',
      category: 'calendar',
      source: 'rate-limit:calendar',
      max: CALENDAR_RATE_LIMIT_MAX,
      window: CALENDAR_RATE_LIMIT_WINDOW,
      title: 'Calendar rate limit exceeded',
     });
  });
});

// ---------------------------------------------------------------------------
// Negatives — no CRITICAL signalling while within the limit
// ---------------------------------------------------------------------------

describe('Within-limit requests are NOT reported as critical', () => {
  it('does not emit a critical log or SSE notification under the threshold', async () => {
    for (let i = 0; i < AUTH_RATE_LIMIT_MAX; i++) {
      expect(checkAuthRateLimit('10.13.37.99')).toBe(true); // all within limit
     }

     // Flush to ensure any stray fire-and-forget has settled.
    await flush();

    expect(checkAuthRateLimit('10.13.37.99')).toBe(false); // now throttled
    await flush();

     // Exactly one critical log + one CRITICAL notification — for the single throttle.
    expect(m.critical).toHaveBeenCalledTimes(1);
    expect(m.warn).not.toHaveBeenCalled();
    expect(m.notificationCreate).toHaveBeenCalledTimes(1);
    expect(persistedNotification()!.priority).toBe(NotificationPriority.CRITICAL);
  });
});

// ---------------------------------------------------------------------------
// Independent buckets — throttling one category must not alert the other
// ---------------------------------------------------------------------------

describe('Independent rate-limit buckets', () => {
  it('throttling auth does not emit an admin/calendar notification', async () => {
    // Exhaust auth (5/min) → one critical report, category auth.
    for (let i = 0; i < AUTH_RATE_LIMIT_MAX; i++) {
      checkAuthRateLimit('10.13.37.1');
     }
    expect(checkAuthRateLimit('10.13.37.1')).toBe(false);
    await flush();

    expect(m.critical).toHaveBeenCalledTimes(1);
    expect(criticalContext()!.category).toBe('auth');
    expect(m.notificationCreate).toHaveBeenCalledTimes(1);
    expect(persistedNotification()!.source).toBe('rate-limit:auth');

     // A second throttle in a different category produces a second alert.
    for (let i = 0; i < CALENDAR_RATE_LIMIT_MAX; i++) {
      checkCalendarRateLimit('session:cal');
     }
    expect(checkCalendarRateLimit('session:cal')).toBe(false);
    await flush();

    expect(m.critical).toHaveBeenCalledTimes(2);
    expect(m.notificationCreate).toHaveBeenCalledTimes(2);
    expect(latestCriticalContext()!.category).toBe('calendar');
    expect(latestNotification()!.source).toBe('rate-limit:calendar');
   });
});

// ---------------------------------------------------------------------------
// Resilience — a failing SSE sink must not throw out of the sync checker
// ---------------------------------------------------------------------------

describe('Throttle reporting resilience', () => {
  it('still returns false and stays non-throwing if the notification sink fails', async () => {
    m.notificationCreate.mockRejectedValueOnce(new Error('DB down'));
    // findFirst also rejected — the persist path is the one that would throw.
    m.notificationFindFirst.mockRejectedValueOnce(new Error('DB down'));

    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      expect(checkRateLimit('session:resilient')).toBe(true);
     }

     // The critical log is emitted synchronously, before the async persist.
    const beforeResult = checkRateLimit('session:resilient');
    expect(beforeResult).toBe(false);
    expect(m.critical).toHaveBeenCalledTimes(1);

     // The rejected fire-and-forget is caught internally (logged via logger.error),
    // no unhandled rejection escapes.
    await flush();
    expect(m.error).toHaveBeenCalledTimes(1);
  });
});
