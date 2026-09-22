/**
 * Integration tests: Rate limiting for notification dispatcher and payload-key endpoints.
 *
 * Strategy:
 *  - Notification dispatcher: use top-level vi.mock with vi.hoisted() mock state so
 *    we can drive dispatchNotification() through its full flow with a controllable
 *    rate-limit state.
 *  - Payload-key endpoint: import the exported checkRateLimit / resetRateLimitStore and
 *    exercise the real in-memory counter.
 *  - Payload-key revoke endpoint: same approach with checkRevokeRateLimit / resetRevokeRateLimitStore.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Shared rate-limiter imports (extracted so route files only export HTTP handlers)
// ---------------------------------------------------------------------------

import {
  checkRateLimit,
  resetRateLimitStore,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW,
} from '@/lib/rate-limiter';

import {
  checkRevokeRateLimit,
  resetRevokeRateLimitStore,
  REVOKE_RATE_LIMIT_MAX,
  REVOKE_RATE_LIMIT_WINDOW,
} from '@/lib/rate-limiter';

import {
  checkAuthRateLimit,
  resetAuthRateLimitStore,
  AUTH_RATE_LIMIT_MAX,
  AUTH_RATE_LIMIT_WINDOW,
} from '@/lib/rate-limiter';

import {
  checkAdminRateLimit,
  resetAdminRateLimitStore,
  ADMIN_RATE_LIMIT_MAX,
  ADMIN_RATE_LIMIT_WINDOW,
} from '@/lib/rate-limiter';

import {
  checkCalendarRateLimit,
  resetCalendarRateLimitStore,
  CALENDAR_RATE_LIMIT_MAX,
  CALENDAR_RATE_LIMIT_WINDOW,
} from '@/lib/rate-limiter';

// ---------------------------------------------------------------------------
// Hoisted mock state — must be before any vi.mock() calls (which are hoisted).
// ---------------------------------------------------------------------------

const { mockRedis, mockSendEmail, mockNotificationLogCreate } = vi.hoisted(() => ({
  mockRedis: {
    get: vi.fn(),
    set: vi.fn(),
    incr: vi.fn(),
  },
  mockSendEmail: vi.fn().mockResolvedValue({ success: true }),
  mockNotificationLogCreate: vi.fn().mockResolvedValue({}),
}));

// ---------------------------------------------------------------------------
// Top-level mocks (hoisted by vitest)
// ---------------------------------------------------------------------------

vi.mock('@/lib/redis', () => ({
  getRedis: () => mockRedis,
}));

vi.mock('@/lib/notifications/email', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

vi.mock('@/lib/tenant-db', () => ({
  default: {
    notificationLog: { create: mockNotificationLogCreate },
  },
}));

// ---------------------------------------------------------------------------
// Notification dispatcher rate limiting
// ---------------------------------------------------------------------------

describe('Notification Dispatcher — Rate Limiting (integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis.get.mockReset();
    mockRedis.set.mockReset();
    mockRedis.incr.mockReset();
    mockSendEmail.mockReset().mockResolvedValue({ success: true });
    mockNotificationLogCreate.mockReset().mockResolvedValue({});

    // Default: first call returns null (no prior notifications)
    mockRedis.get.mockResolvedValue(null);
  });

  it('should send the first notification (within rate limit)', async () => {
    const { dispatchNotification } = await import('@/lib/notifications/dispatcher');

    mockRedis.get.mockResolvedValue(null); // First notification in window
    const result = await dispatchNotification('SUSPICIOUS_LOGIN', 'admin@example.com', 'Alert message');

    expect(result).toEqual({ sent: true, rateLimited: false });
    expect(mockRedis.set).toHaveBeenCalledWith(
      'notif:rate:SUSPICIOUS_LOGIN:admin@example.com',
      '1',
      'EX',
      86400, // 24 hours in seconds
    );
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockNotificationLogCreate).toHaveBeenCalledWith({
      data: {
        recipientEmail: 'admin@example.com',
        eventType: 'SUSPICIOUS_LOGIN',
        message: 'Alert message',
        status: 'SENT',
      },
    });
  });

  it('should send up to maxPerWindow (5) notifications, then rate limit', async () => {
    const { dispatchNotification } = await import('@/lib/notifications/dispatcher');

    // Simulate Redis state: the dispatcher does get → (if null) set to '1' → else incr.
    // We track the current Redis value and let incr update it.
    let redisValue: string | null = null;

    mockRedis.get.mockImplementation(async () => {
      return redisValue; // returns null on first call, then the current count string
    });

    mockRedis.set.mockImplementation(async (_key: string, val: string) => {
      redisValue = val; // first call sets it to '1'
    });

    mockRedis.incr.mockImplementation(async () => {
      const next = parseInt(redisValue || '0', 10) + 1;
      redisValue = String(next);
      return next;
    });

    const results: { sent: boolean; rateLimited: boolean }[] = [];
    for (let i = 0; i < 7; i++) {
      const result = await dispatchNotification('MASS_DELETION', 'admin@example.com', `Alert ${i}`);
      results.push(result);
    }

    // First 5 should be sent, last 2 rate limited
    for (let i = 0; i < 5; i++) {
      expect(results[i]).toEqual({ sent: true, rateLimited: false });
    }
    for (let i = 5; i < 7; i++) {
      expect(results[i]).toEqual({ sent: false, rateLimited: true });
    }

    // Email should only be called 5 times (not 7)
    expect(mockSendEmail).toHaveBeenCalledTimes(5);

    // NotificationLog should only have 5 entries
    expect(mockNotificationLogCreate).toHaveBeenCalledTimes(5);
  });

  it('should be rate-limited immediately when already at the limit', async () => {
    const { dispatchNotification } = await import('@/lib/notifications/dispatcher');

    mockRedis.get.mockResolvedValue('5'); // Already at max
    const result = await dispatchNotification('ORG_SUSPENSION', 'admin@example.com', 'Alert');

    expect(result).toEqual({ sent: false, rateLimited: true });
    // Email should NOT be called
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('should use separate rate limit counters per recipient', async () => {
    const { dispatchNotification } = await import('@/lib/notifications/dispatcher');

    // First recipient gets rate-limited
    mockRedis.get.mockImplementation(async (key: string) => {
      if (key.includes('admin1@example.com')) return '5'; // Already at limit
      return null; // Fresh for admin2
    });

    const result1 = await dispatchNotification('BULK_ROLE_CHANGE', 'admin1@example.com', 'Alert 1');
    const result2 = await dispatchNotification('BULK_ROLE_CHANGE', 'admin2@example.com', 'Alert 2');

    expect(result1).toEqual({ sent: false, rateLimited: true });
    expect(result2).toEqual({ sent: true, rateLimited: false });
  });

  it('should use separate rate limit counters per event type for the same recipient', async () => {
    const { dispatchNotification } = await import('@/lib/notifications/dispatcher');

    mockRedis.get.mockImplementation(async (key: string) => {
      if (key.includes('SUSPICIOUS_LOGIN')) return '5'; // At limit for this event
      return null; // Fresh for other events
    });

    const result1 = await dispatchNotification('SUSPICIOUS_LOGIN', 'admin@example.com', 'Alert 1');
    const result2 = await dispatchNotification('MASS_DELETION', 'admin@example.com', 'Alert 2');

    expect(result1).toEqual({ sent: false, rateLimited: true });
    expect(result2).toEqual({ sent: true, rateLimited: false });
  });

  it('should handle email send failure and log as FAILED', async () => {
    const { dispatchNotification } = await import('@/lib/notifications/dispatcher');

    mockRedis.get.mockResolvedValue(null); // First notification
    mockSendEmail.mockResolvedValue({ success: false, error: 'SMTP connection refused' });

    const result = await dispatchNotification('ORG_ARCHIVAL', 'admin@example.com', 'Org archived');

    expect(result).toEqual({ sent: false, rateLimited: false });
    // Still logged to NotificationLog but with FAILED status
    expect(mockNotificationLogCreate).toHaveBeenCalledWith({
      data: {
        recipientEmail: 'admin@example.com',
        eventType: 'ORG_ARCHIVAL',
        message: 'Org archived',
        status: 'FAILED',
      },
    });
  });

  it('should include organizationId in the notification log when provided', async () => {
    const { dispatchNotification } = await import('@/lib/notifications/dispatcher');

    mockRedis.get.mockResolvedValue(null);
    await dispatchNotification(
      'SUSPICIOUS_LOGIN',
      'admin@example.com',
      'Alert',
      'org-123',
    );

    expect(mockNotificationLogCreate).toHaveBeenCalledWith({
      data: {
        recipientEmail: 'admin@example.com',
        eventType: 'SUSPICIOUS_LOGIN',
        message: 'Alert',
        status: 'SENT',
        organizationId: 'org-123',
      },
    });
  });

  it('should use correct rate limit key format', async () => {
    const { dispatchNotification } = await import('@/lib/notifications/dispatcher');

    mockRedis.get.mockResolvedValue(null);
    await dispatchNotification('MASS_DELETION', 'user@example.com', 'Alert');

    // Verify the key format is notif:rate:{eventType}:{email}
    expect(mockRedis.set).toHaveBeenCalledWith(
      'notif:rate:MASS_DELETION:user@example.com',
      '1',
      'EX',
      86400,
    );
  });

  it('should use correct window duration (24 hours = 86400 seconds)', async () => {
    const { dispatchNotification } = await import('@/lib/notifications/dispatcher');

    mockRedis.get.mockResolvedValue(null);
    await dispatchNotification('BULK_ROLE_CHANGE', 'user@example.com', 'Alert');

    // The window is 24 hours * 3600 seconds = 86400
    expect(mockRedis.set).toHaveBeenCalledWith(
      'notif:rate:BULK_ROLE_CHANGE:user@example.com',
      '1',
      'EX',
      86400,
    );
  });

  it('should increment counter on subsequent notifications in the same window', async () => {
    const { dispatchNotification } = await import('@/lib/notifications/dispatcher');

    let currentCount = 0;
    mockRedis.get.mockImplementation(async () => {
      return currentCount > 0 ? String(currentCount) : null;
    });

    // First notification: set to 1
    await dispatchNotification('SUSPICIOUS_LOGIN', 'user@example.com', 'Alert 1');
    expect(mockRedis.set).toHaveBeenCalledWith(
      'notif:rate:SUSPICIOUS_LOGIN:user@example.com',
      '1',
      'EX',
      86400,
    );

    // Second notification: get returns '1', then incr makes it 2
    currentCount = 1;
    mockRedis.incr.mockResolvedValue(2);
    await dispatchNotification('SUSPICIOUS_LOGIN', 'user@example.com', 'Alert 2');
    expect(mockRedis.incr).toHaveBeenCalledWith(
      'notif:rate:SUSPICIOUS_LOGIN:user@example.com',
    );

    // Third notification: get returns '2', then incr makes it 3
    currentCount = 2;
    mockRedis.incr.mockResolvedValue(3);
    await dispatchNotification('SUSPICIOUS_LOGIN', 'user@example.com', 'Alert 3');
    expect(mockRedis.incr).toHaveBeenCalledWith(
      'notif:rate:SUSPICIOUS_LOGIN:user@example.com',
    );
  });

  it('should not call email or log when rate limited (no side effects)', async () => {
    const { dispatchNotification } = await import('@/lib/notifications/dispatcher');

    mockRedis.get.mockResolvedValue('5'); // Already at limit
    const result = await dispatchNotification('SUSPICIOUS_LOGIN', 'user@example.com', 'Alert');

    expect(result).toEqual({ sent: false, rateLimited: true });
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockNotificationLogCreate).not.toHaveBeenCalled();
  });

  it('should handle all valid event types', async () => {
    const { dispatchNotification } = await import('@/lib/notifications/dispatcher');

    mockRedis.get.mockResolvedValue(null);

    const eventTypes = [
      'MASS_DELETION',
      'BULK_ROLE_CHANGE',
      'SUSPICIOUS_LOGIN',
      'ORG_SUSPENSION',
      'ORG_ARCHIVAL',
      'TODAY_EVENTS',
    ] as const;

    for (const eventType of eventTypes) {
      await dispatchNotification(eventType, 'user@example.com', `Alert for ${eventType}`);
    }

    // All should succeed (different keys per event type)
    expect(mockSendEmail).toHaveBeenCalledTimes(eventTypes.length);
  });

  it('should return correct rateLimited flag in all cases', async () => {
    const { dispatchNotification } = await import('@/lib/notifications/dispatcher');

    // Test sent case
    mockRedis.get.mockResolvedValue(null);
    const result1 = await dispatchNotification('SUSPICIOUS_LOGIN', 'user@example.com', 'Alert');
    expect(result1.rateLimited).toBe(false);
    expect(result1.sent).toBe(true);

    // Test rate-limited case
    mockRedis.get.mockResolvedValue('5');
    const result2 = await dispatchNotification('SUSPICIOUS_LOGIN', 'user@example.com', 'Alert');
    expect(result2.rateLimited).toBe(true);
    expect(result2.sent).toBe(false);

    // Test email failure case (not rate limited, but not sent)
    mockRedis.get.mockResolvedValue(null);
    mockSendEmail.mockResolvedValue({ success: false, error: 'fail' });
    const result3 = await dispatchNotification('SUSPICIOUS_LOGIN', 'user@example.com', 'Alert');
    expect(result3.rateLimited).toBe(false);
    expect(result3.sent).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Payload key endpoint rate limiting
// ---------------------------------------------------------------------------

describe('Payload Key Endpoint — Rate Limiting (integration)', () => {
  beforeEach(() => {
    resetRateLimitStore();
  });

  it('should allow requests up to RATE_LIMIT_MAX per window', async () => {
    resetRateLimitStore();
    const results: boolean[] = [];

    // RATE_LIMIT_MAX is 30 per window
    for (let i = 0; i < 30; i++) {
      results.push(checkRateLimit('session:test-user'));
    }

    // All 30 should be allowed
    expect(results.every((r) => r === true)).toBe(true);

    // The 31st should be rate limited
    expect(checkRateLimit('session:test-user')).toBe(false);

    resetRateLimitStore();
  });

  it('should rate limit after exceeding the maximum', async () => {
    resetRateLimitStore();

    // Exhaust the limit
    for (let i = 0; i < 30; i++) {
      checkRateLimit('session:test-user');
    }

    // Next request should be rate limited
    expect(checkRateLimit('session:test-user')).toBe(false);

    resetRateLimitStore();
  });

  it('should allow different clients independently', async () => {
    resetRateLimitStore();

    // Exhaust session A's limit
    for (let i = 0; i < 30; i++) {
      checkRateLimit('session:user-a');
    }

    // Session A should be rate limited
    expect(checkRateLimit('session:user-a')).toBe(false);

    // Session B should still be allowed
    expect(checkRateLimit('session:user-b')).toBe(true);

    resetRateLimitStore();
  });

  it('should track separate counters per client ID', async () => {
    resetRateLimitStore();

    // Each client gets 30 requests
    const clients = ['session:user-1', 'session:user-2', 'session:user-3'];
    const results: Record<string, boolean[]> = {};

    for (const client of clients) {
      results[client] = [];
      for (let i = 0; i < 32; i++) {
        results[client].push(checkRateLimit(client));
      }
    }

    // Each client should have exactly 30 true, then false
    for (const client of clients) {
      const allowed = results[client].filter((r) => r === true).length;
      expect(allowed).toBe(30);

      const rateLimited = results[client].filter((r) => r === false).length;
      expect(rateLimited).toBe(2); // 32 - 30 = 2
    }

    resetRateLimitStore();
  });

  it('should expose correct rate limit constants', async () => {
    expect(RATE_LIMIT_MAX).toBe(30);
    expect(RATE_LIMIT_WINDOW).toBe(60); // 60 seconds = 1 minute
  });
});

// ---------------------------------------------------------------------------
// Payload key revoke endpoint rate limiting
// ---------------------------------------------------------------------------

describe('Payload Key Revoke Endpoint — Rate Limiting (integration)', () => {
  beforeEach(() => {
    resetRevokeRateLimitStore();
  });

  it('should allow requests up to REVOKE_RATE_LIMIT_MAX per window', async () => {
    resetRevokeRateLimitStore();
    const results: boolean[] = [];

    // REVOKE_RATE_LIMIT_MAX is 5 per window
    for (let i = 0; i < 5; i++) {
      results.push(checkRevokeRateLimit('session:test-user'));
    }

    // All 5 should be allowed
    expect(results.every((r) => r === true)).toBe(true);

    // The 6th should be rate limited
    expect(checkRevokeRateLimit('session:test-user')).toBe(false);

    resetRevokeRateLimitStore();
  });

  it('should rate limit after exceeding the maximum', async () => {
    resetRevokeRateLimitStore();

    // Exhaust the limit (5 requests)
    for (let i = 0; i < 5; i++) {
      checkRevokeRateLimit('session:test-user');
    }

    // Next request should be rate limited
    expect(checkRevokeRateLimit('session:test-user')).toBe(false);

    resetRevokeRateLimitStore();
  });

  it('should allow different clients independently', async () => {
    resetRevokeRateLimitStore();

    // Exhaust session A's limit
    for (let i = 0; i < 5; i++) {
      checkRevokeRateLimit('session:user-a');
    }

    // Session A should be rate limited
    expect(checkRevokeRateLimit('session:user-a')).toBe(false);

    // Session B should still be allowed
    expect(checkRevokeRateLimit('session:user-b')).toBe(true);

    resetRevokeRateLimitStore();
  });

  it('should expose correct rate limit constants', async () => {
    expect(REVOKE_RATE_LIMIT_MAX).toBe(5);
    expect(REVOKE_RATE_LIMIT_WINDOW).toBe(60); // 60 seconds = 1 minute
  });

  it('should be stricter than the key issuance endpoint', async () => {
    // Revoke (5) should be stricter than issuance (30)
    expect(REVOKE_RATE_LIMIT_MAX).toBeLessThan(RATE_LIMIT_MAX);
  });

  it('should track separate counters per client ID for revoke', async () => {
    resetRevokeRateLimitStore();

    // Each client gets 5 requests
    const clients = ['session:user-1', 'session:user-2'];
    const results: Record<string, boolean[]> = {};

    for (const client of clients) {
      results[client] = [];
      for (let i = 0; i < 7; i++) {
        results[client].push(checkRevokeRateLimit(client));
      }
    }

    // Each client should have exactly 5 true, then false
    for (const client of clients) {
      const allowed = results[client].filter((r) => r === true).length;
      expect(allowed).toBe(5);

      const rateLimited = results[client].filter((r) => r === false).length;
      expect(rateLimited).toBe(2); // 7 - 5 = 2
    }

    resetRevokeRateLimitStore();
  });
});

// ---------------------------------------------------------------------------
// Auth endpoint rate limiting (IP-based, brute-force protection)
// ---------------------------------------------------------------------------

describe('Auth Endpoint — Rate Limiting (integration)', () => {
  beforeEach(() => {
    resetAuthRateLimitStore();
  });

  it('should allow requests up to AUTH_RATE_LIMIT_MAX per window', async () => {
    resetAuthRateLimitStore();
    const results: boolean[] = [];

    // AUTH_RATE_LIMIT_MAX is 5 per window
    for (let i = 0; i < 5; i++) {
      results.push(checkAuthRateLimit('192.168.1.100'));
    }

    // All 5 should be allowed
    expect(results.every((r) => r === true)).toBe(true);

    // The 6th should be rate limited
    expect(checkAuthRateLimit('192.168.1.100')).toBe(false);

    resetAuthRateLimitStore();
  });

  it('should rate limit after exceeding the maximum', async () => {
    resetAuthRateLimitStore();

    // Exhaust the limit (5 requests)
    for (let i = 0; i < 5; i++) {
      checkAuthRateLimit('192.168.1.100');
    }

    // Next request should be rate limited
    expect(checkAuthRateLimit('192.168.1.100')).toBe(false);

    resetAuthRateLimitStore();
  });

  it('should allow different IPs independently', async () => {
    resetAuthRateLimitStore();

    // Exhaust IP A's limit
    for (let i = 0; i < 5; i++) {
      checkAuthRateLimit('192.168.1.100');
    }

    // IP A should be rate limited
    expect(checkAuthRateLimit('192.168.1.100')).toBe(false);

    // IP B should still be allowed
    expect(checkAuthRateLimit('10.0.0.50')).toBe(true);

    resetAuthRateLimitStore();
  });

  it('should expose correct rate limit constants', async () => {
    expect(AUTH_RATE_LIMIT_MAX).toBe(5);
    expect(AUTH_RATE_LIMIT_WINDOW).toBe(60); // 60 seconds = 1 minute
  });

  it('should be stricter than payload-key issuance (brute-force protection)', async () => {
    // Auth (5) should be stricter than issuance (30)
    expect(AUTH_RATE_LIMIT_MAX).toBeLessThan(RATE_LIMIT_MAX);
  });

  it('should track separate counters per IP address', async () => {
    resetAuthRateLimitStore();

    // Each IP gets 5 requests
    const ips = ['192.168.1.1', '192.168.1.2', '192.168.1.3'];
    const results: Record<string, boolean[]> = {};

    for (const ip of ips) {
      results[ip] = [];
      for (let i = 0; i < 7; i++) {
        results[ip].push(checkAuthRateLimit(ip));
      }
    }

    // Each IP should have exactly 5 true, then false
    for (const ip of ips) {
      const allowed = results[ip].filter((r) => r === true).length;
      expect(allowed).toBe(5);

      const rateLimited = results[ip].filter((r) => r === false).length;
      expect(rateLimited).toBe(2); // 7 - 5 = 2
    }

    resetAuthRateLimitStore();
  });
});

// ---------------------------------------------------------------------------
// Admin write endpoint rate limiting (session-based, bulk operations)
// ---------------------------------------------------------------------------

describe('Admin Write Endpoints — Rate Limiting (integration)', () => {
  beforeEach(() => {
    resetAdminRateLimitStore();
  });

  it('should allow requests up to ADMIN_RATE_LIMIT_MAX per window', async () => {
    resetAdminRateLimitStore();
    const results: boolean[] = [];

    // ADMIN_RATE_LIMIT_MAX is 30 per window
    for (let i = 0; i < 30; i++) {
      results.push(checkAdminRateLimit('user:admin-1'));
    }

    // All 30 should be allowed
    expect(results.every((r) => r === true)).toBe(true);

    // The 31st should be rate limited
    expect(checkAdminRateLimit('user:admin-1')).toBe(false);

    resetAdminRateLimitStore();
  });

  it('should rate limit after exceeding the maximum', async () => {
    resetAdminRateLimitStore();

    // Exhaust the limit (30 requests)
    for (let i = 0; i < 30; i++) {
      checkAdminRateLimit('user:admin-1');
    }

    // Next request should be rate limited
    expect(checkAdminRateLimit('user:admin-1')).toBe(false);

    resetAdminRateLimitStore();
  });

  it('should allow different users independently', async () => {
    resetAdminRateLimitStore();

    // Exhaust user A's limit
    for (let i = 0; i < 30; i++) {
      checkAdminRateLimit('user:admin-a');
    }

    // User A should be rate limited
    expect(checkAdminRateLimit('user:admin-a')).toBe(false);

    // User B should still be allowed
    expect(checkAdminRateLimit('user:admin-b')).toBe(true);

    resetAdminRateLimitStore();
  });

  it('should expose correct rate limit constants', async () => {
    expect(ADMIN_RATE_LIMIT_MAX).toBe(30);
    expect(ADMIN_RATE_LIMIT_WINDOW).toBe(60); // 60 seconds = 1 minute
  });

  it('should track separate counters per user ID', async () => {
    resetAdminRateLimitStore();

    // Each user gets 30 requests
    const users = ['user:admin-1', 'user:admin-2'];
    const results: Record<string, boolean[]> = {};

    for (const userId of users) {
      results[userId] = [];
      for (let i = 0; i < 32; i++) {
        results[userId].push(checkAdminRateLimit(userId));
      }
    }

    // Each user should have exactly 30 true, then false
    for (const userId of users) {
      const allowed = results[userId].filter((r) => r === true).length;
      expect(allowed).toBe(30);

      const rateLimited = results[userId].filter((r) => r === false).length;
      expect(rateLimited).toBe(2); // 32 - 30 = 2
    }

    resetAdminRateLimitStore();
  });
});

// ---------------------------------------------------------------------------
// Calendar event write endpoint rate limiting (session-based, CRUD)
// ---------------------------------------------------------------------------

describe('Calendar Event Endpoints — Rate Limiting (integration)', () => {
  beforeEach(() => {
    resetCalendarRateLimitStore();
  });

  it('should allow requests up to CALENDAR_RATE_LIMIT_MAX per window', async () => {
    resetCalendarRateLimitStore();
    const results: boolean[] = [];

    // CALENDAR_RATE_LIMIT_MAX is 30 per window
    for (let i = 0; i < 30; i++) {
      results.push(checkCalendarRateLimit('user:calendar-admin'));
    }

    // All 30 should be allowed
    expect(results.every((r) => r === true)).toBe(true);

    // The 31st should be rate limited
    expect(checkCalendarRateLimit('user:calendar-admin')).toBe(false);

    resetCalendarRateLimitStore();
  });

  it('should rate limit after exceeding the maximum', async () => {
    resetCalendarRateLimitStore();

    // Exhaust the limit (30 requests)
    for (let i = 0; i < 30; i++) {
      checkCalendarRateLimit('user:calendar-admin');
    }

    // Next request should be rate limited
    expect(checkCalendarRateLimit('user:calendar-admin')).toBe(false);

    resetCalendarRateLimitStore();
  });

  it('should allow different users independently', async () => {
    resetCalendarRateLimitStore();

    // Exhaust user A's limit
    for (let i = 0; i < 30; i++) {
      checkCalendarRateLimit('user:calendar-a');
    }

    // User A should be rate limited
    expect(checkCalendarRateLimit('user:calendar-a')).toBe(false);

    // User B should still be allowed
    expect(checkCalendarRateLimit('user:calendar-b')).toBe(true);

    resetCalendarRateLimitStore();
  });

  it('should expose correct rate limit constants', async () => {
    expect(CALENDAR_RATE_LIMIT_MAX).toBe(30);
    expect(CALENDAR_RATE_LIMIT_WINDOW).toBe(60); // 60 seconds = 1 minute
  });

  it('should track separate counters per user ID', async () => {
    resetCalendarRateLimitStore();

    // Each user gets 30 requests
    const users = ['user:cal-1', 'user:cal-2'];
    const results: Record<string, boolean[]> = {};

    for (const userId of users) {
      results[userId] = [];
      for (let i = 0; i < 32; i++) {
        results[userId].push(checkCalendarRateLimit(userId));
      }
    }

    // Each user should have exactly 30 true, then false
    for (const userId of users) {
      const allowed = results[userId].filter((r) => r === true).length;
      expect(allowed).toBe(30);

      const rateLimited = results[userId].filter((r) => r === false).length;
      expect(rateLimited).toBe(2); // 32 - 30 = 2
    }

    resetCalendarRateLimitStore();
  });
});
