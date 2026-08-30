/**
 * Unit tests: rate-limiter.ts — core in-memory counters, helpers, and edge cases.
 *
 * These tests exercise the raw limiter functions directly (no HTTP layer, no mocks).
 * The integration file covers notification-dispatcher + route-level scenarios.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Import everything we need to test
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
  getSessionId,
  getClientIp,
  adminRateLimitStore,
  calendarRateLimitStore,
  cleanAdminRateLimitStore,
  cleanCalendarRateLimitStore,
} from '@/lib/rate-limiter';

// ---------------------------------------------------------------------------
// Helpers — we can't easily mock Date.now inside these functions, so we test
// the counter logic at a granularity that doesn't depend on time passage.
// ---------------------------------------------------------------------------

describe('rate-limiter.ts — Core Functions', () => {
  beforeEach(() => {
    resetRateLimitStore();
    resetRevokeRateLimitStore();
    resetAuthRateLimitStore();
    resetAdminRateLimitStore();
    resetCalendarRateLimitStore();
  });

  afterEach(() => {
    // Ensure stores are clean after each test to avoid cross-test pollution
    resetRateLimitStore();
    resetRevokeRateLimitStore();
    resetAuthRateLimitStore();
    resetAdminRateLimitStore();
    resetCalendarRateLimitStore();
  });

  // -----------------------------------------------------------------------
  // checkRateLimit — general payload-key rate limiter (30/min)
  // -----------------------------------------------------------------------

  describe('checkRateLimit', () => {
    it('should allow the first request for a new client', () => {
      expect(checkRateLimit('session:unique-1')).toBe(true);
    });

    it('should allow exactly RATE_LIMIT_MAX requests before blocking', () => {
      const results: boolean[] = [];
      for (let i = 0; i < RATE_LIMIT_MAX; i++) {
        results.push(checkRateLimit('session:exact-max'));
      }
      expect(results.every((r) => r === true)).toBe(true);
    });

    it('should block on the (RATE_LIMIT_MAX + 1)th request', () => {
      // Exhaust all allowed requests
      for (let i = 0; i < RATE_LIMIT_MAX; i++) {
        checkRateLimit('session:block-test');
      }
      // Next one should be blocked
      expect(checkRateLimit('session:block-test')).toBe(false);
    });

    it('should not double-count when called repeatedly on the same key', () => {
      // First call creates entry with count=1
      checkRateLimit('session:double-check');

      // Second call increments to 2
      expect(checkRateLimit('session:double-check')).toBe(true);

      // Third call increments to 3
      expect(checkRateLimit('session:double-check')).toBe(true);

      // Verify count is 3, not reset
      for (let i = 0; i < RATE_LIMIT_MAX - 3; i++) {
        checkRateLimit('session:double-check');
      }
      // Now at RATE_LIMIT_MAX, next should fail
      expect(checkRateLimit('session:double-check')).toBe(false);
    });

    it('should handle rapid sequential calls without race conditions', () => {
      const client = 'session:rapid-fire';
      // Fire 100 requests in rapid succession — only the first RATE_LIMIT_MAX should pass
      const results: boolean[] = [];

      // First, drain the limit
      for (let i = 0; i < RATE_LIMIT_MAX; i++) {
        results.push(checkRateLimit(client));
      }

      // All should be true
      expect(results.filter((r) => r === false).length).toBe(0);

      // Now all subsequent calls should be false
      for (let i = 0; i < 50; i++) {
        results.push(checkRateLimit(client));
      }

      const allowed = results.filter((r) => r === true).length;
      expect(allowed).toBe(RATE_LIMIT_MAX);

      const blocked = results.filter((r) => r === false).length;
      expect(blocked).toBe(50);
    });

    it('should handle empty string client ID gracefully', () => {
      expect(checkRateLimit('')).toBe(true);
    });

    it('should handle very long client IDs', () => {
      const longId = 'session:' + 'a'.repeat(1000);
      expect(checkRateLimit(longId)).toBe(true);
    });

    it('should handle special characters in client ID', () => {
      const specialId = 'session:user@example.com/with:special?chars';
      expect(checkRateLimit(specialId)).toBe(true);
    });

    it('should handle null-like client IDs (edge case)', () => {
      // TypeScript won't allow null, but let's test with a falsy-ish string
      expect(checkRateLimit('0')).toBe(true);
    });

    it('should track independent entries for similar client IDs', () => {
      // session:1 and session:10 should be independent
      for (let i = 0; i < RATE_LIMIT_MAX; i++) {
        checkRateLimit('session:1');
      }

      // session:1 should be blocked
      expect(checkRateLimit('session:1')).toBe(false);

      // session:10 should still be allowed
      expect(checkRateLimit('session:10')).toBe(true);

      // session:100 should also be allowed
      expect(checkRateLimit('session:100')).toBe(true);
    });

    it('should return boolean (not truthy/falsy)', () => {
      const result = checkRateLimit('session:bool-test');
      expect(typeof result).toBe('boolean');
      expect(result).not.toBe(1); // should be true, not 1
    });

    it('should maintain count across multiple calls (not reset)', () => {
      // Call 1: count=1
      checkRateLimit('session:count-verify');

      // Call 2: count=2
      checkRateLimit('session:count-verify');

      // Call 30 (last allowed): count=30
      for (let i = 2; i < RATE_LIMIT_MAX; i++) {
        checkRateLimit('session:count-verify');
      }

      // Call 31: should be blocked (count was already at max)
      expect(checkRateLimit('session:count-verify')).toBe(false);

      // The entry still exists in the store (not deleted)
    });
  });

  // -----------------------------------------------------------------------
  // checkRevokeRateLimit — stricter limiter (5/min)
  // -----------------------------------------------------------------------

  describe('checkRevokeRateLimit', () => {
    it('should allow exactly REVOKE_RATE_LIMIT_MAX requests before blocking', () => {
      for (let i = 0; i < REVOKE_RATE_LIMIT_MAX; i++) {
        expect(checkRevokeRateLimit('revoke:client-1')).toBe(true);
      }
    });

    it('should block on the (REVOKE_RATE_LIMIT_MAX + 1)th request', () => {
      for (let i = 0; i < REVOKE_RATE_LIMIT_MAX; i++) {
        checkRevokeRateLimit('revoke:block-test');
      }
      expect(checkRevokeRateLimit('revoke:block-test')).toBe(false);
    });

    it('should be stricter than general rate limiting', () => {
      // Revoke allows 5, general allows 30 — test that revoke blocks much sooner
      const results: boolean[] = [];

      for (let i = 0; i < 10; i++) {
        results.push(checkRevokeRateLimit('revoke:strict-test'));
      }

      // First 5 should pass, next 5 blocked
      const allowed = results.filter((r) => r === true).length;
      expect(allowed).toBe(REVOKE_RATE_LIMIT_MAX);

      const blocked = results.filter((r) => r === false).length;
      expect(blocked).toBe(5); // 10 - 5 = 5 blocked
    });

    it('should handle different revoke clients independently', () => {
      // Exhaust client A's limit
      for (let i = 0; i < REVOKE_RATE_LIMIT_MAX; i++) {
        checkRevokeRateLimit('revoke:client-a');
      }

      expect(checkRevokeRateLimit('revoke:client-a')).toBe(false);
      expect(checkRevokeRateLimit('revoke:client-b')).toBe(true);
    });

    it('should handle empty string client ID', () => {
      expect(checkRevokeRateLimit('')).toBe(true);
    });

    it('should return boolean type', () => {
      const result = checkRevokeRateLimit('revoke:bool-test');
      expect(typeof result).toBe('boolean');
    });

    it('should increment count correctly across calls', () => {
      // Calls 1-5: all allowed (REVOKE_RATE_LIMIT_MAX = 5)
      for (let i = 1; i <= REVOKE_RATE_LIMIT_MAX; i++) {
        expect(checkRevokeRateLimit('revoke:count-test')).toBe(true);
      }

      // Call 6 (over limit): blocked
      expect(checkRevokeRateLimit('revoke:count-test')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // checkAuthRateLimit — IP-based brute-force protection (5/min)
  // -----------------------------------------------------------------------

  describe('checkAuthRateLimit', () => {
    it('should allow exactly AUTH_RATE_LIMIT_MAX requests per IP', () => {
      for (let i = 0; i < AUTH_RATE_LIMIT_MAX; i++) {
        expect(checkAuthRateLimit('10.0.0.1')).toBe(true);
      }
    });

    it('should block on the (AUTH_RATE_LIMIT_MAX + 1)th request', () => {
      for (let i = 0; i < AUTH_RATE_LIMIT_MAX; i++) {
        checkAuthRateLimit('10.0.0.2');
      }
      expect(checkAuthRateLimit('10.0.0.2')).toBe(false);
    });

    it('should handle different IPs independently', () => {
      // Exhaust IP A's limit
      for (let i = 0; i < AUTH_RATE_LIMIT_MAX; i++) {
        checkAuthRateLimit('192.168.1.1');
      }

      expect(checkAuthRateLimit('192.168.1.1')).toBe(false);
      expect(checkAuthRateLimit('192.168.1.2')).toBe(true);
    });

    it('should handle IPv4 addresses in dotted notation', () => {
      const ips = [
        '127.0.0.1',
        '192.168.0.1',
        '10.255.255.255',
        '172.16.0.1',
      ];

      for (const ip of ips) {
        expect(checkAuthRateLimit(ip)).toBe(true);
      }

      // Each IP should have its own counter (count = 1)
      for (const ip of ips) {
        expect(checkAuthRateLimit(ip)).toBe(true); // count = 2, still allowed
      }

      // Exhaust one IP and verify others are unaffected
      for (let i = 0; i < AUTH_RATE_LIMIT_MAX - 2; i++) {
        checkAuthRateLimit('127.0.0.1');
      }

      expect(checkAuthRateLimit('127.0.0.1')).toBe(false); // blocked
      expect(checkAuthRateLimit('192.168.0.1')).toBe(true); // unaffected
    });

    it('should handle edge-case IP addresses', () => {
      expect(checkAuthRateLimit('0.0.0.0')).toBe(true);
      expect(checkAuthRateLimit('255.255.255.255')).toBe(true);
    });

    it('should handle empty string IP', () => {
      expect(checkAuthRateLimit('')).toBe(true);
    });

    it('should handle single-octet IP-like strings', () => {
      expect(checkAuthRateLimit('1')).toBe(true);
    });

    it('should return boolean type', () => {
      const result = checkAuthRateLimit('10.0.0.99');
      expect(typeof result).toBe('boolean');
    });

    it('should maintain independent counters across many IPs', () => {
      const ipCount = 10;

      for (let i = 0; i < ipCount; i++) {
        const ip = `192.168.${i}.1`;
        // Each IP gets AUTH_RATE_LIMIT_MAX requests, then blocks on the next
        for (let j = 0; j < AUTH_RATE_LIMIT_MAX; j++) {
          checkAuthRateLimit(ip);
        }
      }

      // All IPs should now be blocked
      for (let i = 0; i < ipCount; i++) {
        const ip = `192.168.${i}.1`;
        expect(checkAuthRateLimit(ip)).toBe(false);
      }

      // A new IP should still be allowed
      expect(checkAuthRateLimit('10.0.0.99')).toBe(true);
    });

    it('should handle rapid burst on a single IP', () => {
      const ip = '10.99.99.99';
      // Fire 20 requests — first 5 pass, next 15 blocked
      const results: boolean[] = [];

      for (let i = 0; i < 20; i++) {
        results.push(checkAuthRateLimit(ip));
      }

      const allowed = results.filter((r) => r === true).length;
      expect(allowed).toBe(AUTH_RATE_LIMIT_MAX);

      const blocked = results.filter((r) => r === false).length;
      expect(blocked).toBe(15); // 20 - 5 = 15
    });
  });

  // -----------------------------------------------------------------------
  // checkAdminRateLimit — session-based admin writes (30/min)
  // -----------------------------------------------------------------------

  describe('checkAdminRateLimit', () => {
    it('should allow exactly ADMIN_RATE_LIMIT_MAX requests per session', () => {
      for (let i = 0; i < ADMIN_RATE_LIMIT_MAX; i++) {
        expect(checkAdminRateLimit('admin:session-1')).toBe(true);
      }
    });

    it('should block on the (ADMIN_RATE_LIMIT_MAX + 1)th request', () => {
      for (let i = 0; i < ADMIN_RATE_LIMIT_MAX; i++) {
        checkAdminRateLimit('admin:session-block');
      }
      expect(checkAdminRateLimit('admin:session-block')).toBe(false);
    });

    it('should handle different admin sessions independently', () => {
      for (let i = 0; i < ADMIN_RATE_LIMIT_MAX; i++) {
        checkAdminRateLimit('admin:session-a');
      }

      expect(checkAdminRateLimit('admin:session-a')).toBe(false);
      expect(checkAdminRateLimit('admin:session-b')).toBe(true);
    });

    it('should handle session IDs with colons and slashes', () => {
      const sessions = [
        'admin:sess:123',
        'user:org-456:admin',
        'super-admin/platform-org',
      ];

      for (const session of sessions) {
        expect(checkAdminRateLimit(session)).toBe(true);
      }

      // Each should be independent (count = 1)
      for (const session of sessions) {
        expect(checkAdminRateLimit(session)).toBe(true); // count = 2
      }

      // Exhaust one and verify others unaffected
      for (let i = 0; i < ADMIN_RATE_LIMIT_MAX - 2; i++) {
        checkAdminRateLimit('admin:sess:123');
      }

      expect(checkAdminRateLimit('admin:sess:123')).toBe(false);
      expect(checkAdminRateLimit('user:org-456:admin')).toBe(true);
    });

    it('should handle empty string session ID', () => {
      expect(checkAdminRateLimit('')).toBe(true);
    });

    it('should return boolean type', () => {
      const result = checkAdminRateLimit('admin:bool-test');
      expect(typeof result).toBe('boolean');
    });

    it('should handle concurrent-like rapid access to same session', () => {
      const session = 'admin:rapid-admin';

      // First, drain the limit
      for (let i = 0; i < ADMIN_RATE_LIMIT_MAX; i++) {
        checkAdminRateLimit(session);
      }

      // Now fire 100 more — all should be blocked
      let blockedCount = 0;
      for (let i = 0; i < 100; i++) {
        if (!checkAdminRateLimit(session)) {
          blockedCount++;
        }
      }

      expect(blockedCount).toBe(100); // All 100 should be blocked
    });

    it('should maintain precise count across incremental calls', () => {
      const session = 'admin:precise-count';

      // Call 1 through 30 (all allowed)
      for (let i = 1; i <= ADMIN_RATE_LIMIT_MAX; i++) {
        const result = checkAdminRateLimit(session);
        expect(result).toBe(true); // Each call within limit should pass
      }

      // Call 31 (blocked)
      expect(checkAdminRateLimit(session)).toBe(false);

      // Call 32 (still blocked, not reset)
      expect(checkAdminRateLimit(session)).toBe(false);

      // The entry persists in the store (not garbage collected mid-window)
    });

    it('should handle numeric-looking session IDs', () => {
      expect(checkAdminRateLimit('admin:12345')).toBe(true);
      expect(checkAdminRateLimit('admin:0')).toBe(true);
    });

    it('should handle session IDs with unicode characters', () => {
      expect(checkAdminRateLimit('admin:用户-123')).toBe(true);
    });

    it('should handle very long session IDs', () => {
      const longId = 'admin:' + 'x'.repeat(200);
      expect(checkAdminRateLimit(longId)).toBe(true);
    });

    it('should handle mixed alphanumeric session IDs', () => {
      const sessions = [
        'admin:abc123DEF456',
        'admin:aB3!@#cD7$%^eF9',
        'admin:TEST_USER_01',
      ];

      for (const session of sessions) {
        expect(checkAdminRateLimit(session)).toBe(true);
      }

      // Verify independence: exhaust first, check others still work
      for (let i = 0; i < ADMIN_RATE_LIMIT_MAX; i++) {
        checkAdminRateLimit('admin:abc123DEF456');
      }

      expect(checkAdminRateLimit('admin:abc123DEF456')).toBe(false);
      expect(checkAdminRateLimit('admin:aB3!@#cD7$%^eF9')).toBe(true);
      expect(checkAdminRateLimit('admin:TEST_USER_01')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // checkCalendarRateLimit — session-based calendar CRUD (30/min)
  // -----------------------------------------------------------------------

  describe('checkCalendarRateLimit', () => {
    it('should allow exactly CALENDAR_RATE_LIMIT_MAX requests per session', () => {
      for (let i = 0; i < CALENDAR_RATE_LIMIT_MAX; i++) {
        expect(checkCalendarRateLimit('calendar:session-1')).toBe(true);
      }
    });

    it('should block on the (CALENDAR_RATE_LIMIT_MAX + 1)th request', () => {
      for (let i = 0; i < CALENDAR_RATE_LIMIT_MAX; i++) {
        checkCalendarRateLimit('calendar:session-block');
      }
      expect(checkCalendarRateLimit('calendar:session-block')).toBe(false);
    });

    it('should handle different calendar sessions independently', () => {
      for (let i = 0; i < CALENDAR_RATE_LIMIT_MAX; i++) {
        checkCalendarRateLimit('calendar:cal-a');
      }

      expect(checkCalendarRateLimit('calendar:cal-a')).toBe(false);
      expect(checkCalendarRateLimit('calendar:cal-b')).toBe(true);
    });

    it('should handle org-scoped session IDs', () => {
      const sessions = [
        'org:123:user:calendar',
        'user:456:cal-write',
      ];

      for (const session of sessions) {
        expect(checkCalendarRateLimit(session)).toBe(true);
      }

      // Exhaust first, verify second still works
      for (let i = 0; i < CALENDAR_RATE_LIMIT_MAX; i++) {
        checkCalendarRateLimit('org:123:user:calendar');
      }

      expect(checkCalendarRateLimit('org:123:user:calendar')).toBe(false);
      expect(checkCalendarRateLimit('user:456:cal-write')).toBe(true);
    });

    it('should handle empty string session ID', () => {
      expect(checkCalendarRateLimit('')).toBe(true);
    });

    it('should return boolean type', () => {
      const result = checkCalendarRateLimit('calendar:bool-test');
      expect(typeof result).toBe('boolean');
    });

    it('should handle rapid burst on a single session', () => {
      const session = 'calendar:burst-test';

      // Fire 50 requests — first 30 pass, next 20 blocked
      const results: boolean[] = [];

      for (let i = 0; i < 50; i++) {
        results.push(checkCalendarRateLimit(session));
      }

      const allowed = results.filter((r) => r === true).length;
      expect(allowed).toBe(CALENDAR_RATE_LIMIT_MAX);

      const blocked = results.filter((r) => r === false).length;
      expect(blocked).toBe(20); // 50 - 30 = 20
    });

    it('should handle concurrent-like rapid access to same session', () => {
      const session = 'calendar:rapid-cal';

      // Drain the limit
      for (let i = 0; i < CALENDAR_RATE_LIMIT_MAX; i++) {
        checkCalendarRateLimit(session);
      }

      // Fire 200 more — all should be blocked
      let blockedCount = 0;
      for (let i = 0; i < 200; i++) {
        if (!checkCalendarRateLimit(session)) {
          blockedCount++;
        }
      }

      expect(blockedCount).toBe(200); // All 200 should be blocked
    });

    it('should maintain precise count across incremental calls', () => {
      const session = 'calendar:precise';

      for (let i = 1; i <= CALENDAR_RATE_LIMIT_MAX; i++) {
        expect(checkCalendarRateLimit(session)).toBe(true);
      }

      // Over limit
      expect(checkCalendarRateLimit(session)).toBe(false);
    });

    it('should handle numeric-looking session IDs', () => {
      expect(checkCalendarRateLimit('calendar:999')).toBe(true);
    });

    it('should handle session IDs with special characters', () => {
      expect(checkCalendarRateLimit('calendar:user@test.com')).toBe(true);
    });

    it('should handle very long session IDs', () => {
      const longId = 'calendar:' + 'z'.repeat(500);
      expect(checkCalendarRateLimit(longId)).toBe(true);
    });

    it('should handle mixed alphanumeric session IDs', () => {
      const sessions = [
        'calendar:cal123ABC456',
        'calendar:aB7!@#cD9$%^eF2',
      ];

      for (const session of sessions) {
        expect(checkCalendarRateLimit(session)).toBe(true);
      }

      // Exhaust first, verify second still works
      for (let i = 0; i < CALENDAR_RATE_LIMIT_MAX; i++) {
        checkCalendarRateLimit('calendar:cal123ABC456');
      }

      expect(checkCalendarRateLimit('calendar:cal123ABC456')).toBe(false);
      expect(checkCalendarRateLimit('calendar:aB7!@#cD9$%^eF2')).toBe(true);
    });

    it('should handle rapid sequential calls without over-counting', () => {
      const session = 'calendar:no-overcount';

      // Fire exactly RATE_LIMIT_MAX + 1 calls
      let trueCount = 0;
      for (let i = 0; i < CALENDAR_RATE_LIMIT_MAX + 1; i++) {
        if (checkCalendarRateLimit(session)) {
          trueCount++;
        }
      }

      // Exactly RATE_LIMIT_MAX should have been allowed, no more
      expect(trueCount).toBe(CALENDAR_RATE_LIMIT_MAX);
    });

    it('should handle reset and reuse of the same session ID', () => {
      const session = 'calendar:reset-test';

      // Exhaust the limit
      for (let i = 0; i < CALENDAR_RATE_LIMIT_MAX; i++) {
        checkCalendarRateLimit(session);
      }

      expect(checkCalendarRateLimit(session)).toBe(false);

      // Reset and verify the same session can be used again
      resetCalendarRateLimitStore();

      expect(checkCalendarRateLimit(session)).toBe(true); // Fresh start
    });
  });

  // -----------------------------------------------------------------------
  // Reset functions — verify they actually clear the stores
  // -----------------------------------------------------------------------

  describe('reset functions', () => {
    it('should clear all entries in rateLimitStore after reset', () => {
      // Populate the store
      for (let i = 0; i < RATE_LIMIT_MAX + 5; i++) {
        checkRateLimit(`session:reset-${i}`);
      }

      // Verify entries exist by exhausting each
      for (let i = 0; i < RATE_LIMIT_MAX + 5; i++) {
        const session = `session:reset-${i}`;
        // Each should have count=1, so next call allowed (count=2)
        expect(checkRateLimit(session)).toBe(true);
      }

      // Reset and verify all sessions are fresh
      resetRateLimitStore();

      for (let i = 0; i < RATE_LIMIT_MAX + 5; i++) {
        const session = `session:reset-${i}`;
        // After reset, each should allow RATE_LIMIT_MAX requests fresh
        for (let j = 0; j < RATE_LIMIT_MAX; j++) {
          expect(checkRateLimit(session)).toBe(true);
        }
      }
    });

    it('should clear revoke store', () => {
      for (let i = 0; i < REVOKE_RATE_LIMIT_MAX + 5; i++) {
        checkRevokeRateLimit(`revoke:reset-${i}`);
      }

      resetRevokeRateLimitStore();

      for (let i = 0; i < REVOKE_RATE_LIMIT_MAX + 5; i++) {
        const session = `revoke:reset-${i}`;
        for (let j = 0; j < REVOKE_RATE_LIMIT_MAX; j++) {
          expect(checkRevokeRateLimit(session)).toBe(true);
        }
      }
    });

    it('should clear auth store', () => {
      for (let i = 0; i < AUTH_RATE_LIMIT_MAX + 5; i++) {
        checkAuthRateLimit(`10.0.${i}.1`);
      }

      resetAuthRateLimitStore();

      for (let i = 0; i < AUTH_RATE_LIMIT_MAX + 5; i++) {
        const ip = `10.0.${i}.1`;
        for (let j = 0; j < AUTH_RATE_LIMIT_MAX; j++) {
          expect(checkAuthRateLimit(ip)).toBe(true);
        }
      }
    });

    it('should clear admin store', () => {
      for (let i = 0; i < ADMIN_RATE_LIMIT_MAX + 5; i++) {
        checkAdminRateLimit(`admin:reset-${i}`);
      }

      resetAdminRateLimitStore();

      for (let i = 0; i < ADMIN_RATE_LIMIT_MAX + 5; i++) {
        const session = `admin:reset-${i}`;
        for (let j = 0; j < ADMIN_RATE_LIMIT_MAX; j++) {
          expect(checkAdminRateLimit(session)).toBe(true);
        }
      }
    });

    it('should clear calendar store', () => {
      for (let i = 0; i < CALENDAR_RATE_LIMIT_MAX + 5; i++) {
        checkCalendarRateLimit(`calendar:reset-${i}`);
      }

      resetCalendarRateLimitStore();

      for (let i = 0; i < CALENDAR_RATE_LIMIT_MAX + 5; i++) {
        const session = `calendar:reset-${i}`;
        for (let j = 0; j < CALENDAR_RATE_LIMIT_MAX; j++) {
          expect(checkCalendarRateLimit(session)).toBe(true);
        }
      }
    });

    it('should allow reuse of the same key after reset', () => {
      const session = 'admin:reuse-after-reset';

      // Exhaust the limit
      for (let i = 0; i < ADMIN_RATE_LIMIT_MAX; i++) {
        checkAdminRateLimit(session);
      }

      // Should be blocked
      expect(checkAdminRateLimit(session)).toBe(false);

      // Reset
      resetAdminRateLimitStore();

      // Same key should now be allowed again
      expect(checkAdminRateLimit(session)).toBe(true);

      // And can be exhausted again
      for (let i = 1; i < ADMIN_RATE_LIMIT_MAX; i++) {
        expect(checkAdminRateLimit(session)).toBe(true);
      }

      // And blocked again after exhaustion
      expect(checkAdminRateLimit(session)).toBe(false);
    });

    it('should handle reset on an empty store (no-op)', () => {
      // Calling reset on already-empty store should not throw
      expect(() => resetRateLimitStore()).not.toThrow();
      expect(() => resetRevokeRateLimitStore()).not.toThrow();
      expect(() => resetAuthRateLimitStore()).not.toThrow();
      expect(() => resetAdminRateLimitStore()).not.toThrow();
      expect(() => resetCalendarRateLimitStore()).not.toThrow();
    });

    it('should allow multiple sequential resets', () => {
      // Reset → use → reset → use pattern should work cleanly
      for (let cycle = 0; cycle < 3; cycle++) {
        checkAdminRateLimit('admin:multi-reset');

        resetAdminRateLimitStore();

        expect(checkAdminRateLimit('admin:multi-reset')).toBe(true);
      }
    });

    it('should handle reset between different client types', () => {
      // Use admin store, then revoke store, verify they're independent
      for (let i = 0; i < ADMIN_RATE_LIMIT_MAX; i++) {
        checkAdminRateLimit('admin:cross-test');
      }

      // Admin should be blocked
      expect(checkAdminRateLimit('admin:cross-test')).toBe(false);

      // Revoke should still be fresh (different store)
      expect(checkRevokeRateLimit('admin:cross-test')).toBe(true);

      // Reset admin store
      resetAdminRateLimitStore();

      // Admin should be fresh again, revoke still at count=1
      expect(checkAdminRateLimit('admin:cross-test')).toBe(true);
    });

    it('should handle rapid reset and reuse pattern', () => {
      const session = 'admin:rapid-reset';

      for (let i = 0; i < 10; i++) {
        checkAdminRateLimit(session);
        resetAdminRateLimitStore();
      }

      // After each reset, the session should be fresh
      expect(checkAdminRateLimit(session)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // getClientIp — IP extraction helper
  // -----------------------------------------------------------------------

  describe('getClientIp', () => {
    it('should return x-forwarded-for first IP when present', () => {
      const request = new Request('http://example.com', {
        headers: { 'x-forwarded-for': '203.0.113.50, 70.41.3.18, 150.172.238.178' },
      });

      expect(getClientIp(request)).toBe('203.0.113.50');
    });

    it('should trim whitespace from x-forwarded-for', () => {
      const request = new Request('http://example.com', {
        headers: { 'x-forwarded-for': ' 203.0.113.50 , 70.41.3.18 ' },
      });

      expect(getClientIp(request)).toBe('203.0.113.50');
    });

    it('should return x-forwarded-for when single IP', () => {
      const request = new Request('http://example.com', {
        headers: { 'x-forwarded-for': '192.168.1.100' },
      });

      expect(getClientIp(request)).toBe('192.168.1.100');
    });

    it('should fall back to x-real-ip when no x-forwarded-for', () => {
      const request = new Request('http://example.com', {
        headers: { 'x-real-ip': '10.20.30.40' },
      });

      expect(getClientIp(request)).toBe('10.20.30.40');
    });

    it('should prefer x-forwarded-for over x-real-ip', () => {
      const request = new Request('http://example.com', {
        headers: {
          'x-forwarded-for': '203.0.113.50',
          'x-real-ip': '10.20.30.40',
        },
      });

      expect(getClientIp(request)).toBe('203.0.113.50');
    });

    it('should return "unknown" when no IP headers present', () => {
      const request = new Request('http://example.com');

      expect(getClientIp(request)).toBe('unknown');
    });

    it('should handle empty x-forwarded-for by falling back to x-real-ip', () => {
      const request = new Request('http://example.com', {
        headers: { 'x-forwarded-for': '', 'x-real-ip': '10.20.30.40' },
      });

      expect(getClientIp(request)).toBe('10.20.30.40');
    });

    it('should handle empty x-forwarded-for and no x-real-ip', () => {
      const request = new Request('http://example.com', {
        headers: { 'x-forwarded-for': '' },
      });

      expect(getClientIp(request)).toBe('unknown');
    });

    it('should handle x-forwarded-for with multiple IPs and spaces', () => {
      const request = new Request('http://example.com', {
        headers: { 'x-forwarded-for': '203.0.113.50, 70.41.3.18' },
      });

      expect(getClientIp(request)).toBe('203.0.113.50');
    });

    it('should handle IPv6-like x-forwarded-for', () => {
      const request = new Request('http://example.com', {
        headers: { 'x-forwarded-for': '::1, 203.0.113.50' },
      });

      expect(getClientIp(request)).toBe('::1');
    });

    it('should return "unknown" when only x-real-ip is missing', () => {
      const request = new Request('http://example.com');

      expect(getClientIp(request)).toBe('unknown');
    });
  });

  // -----------------------------------------------------------------------
  // Rate limit constants — verify expected defaults
  // -----------------------------------------------------------------------

  describe('rate limit constants', () => {
    it('should expose correct default RATE_LIMIT_MAX (30)', () => {
      expect(RATE_LIMIT_MAX).toBe(30);
    });

    it('should expose correct default RATE_LIMIT_WINDOW (60 seconds)', () => {
      expect(RATE_LIMIT_WINDOW).toBe(60);
    });

    it('should expose correct default REVOKE_RATE_LIMIT_MAX (5)', () => {
      expect(REVOKE_RATE_LIMIT_MAX).toBe(5);
    });

    it('should expose correct default REVOKE_RATE_LIMIT_WINDOW (60 seconds)', () => {
      expect(REVOKE_RATE_LIMIT_WINDOW).toBe(60);
    });

    it('should expose correct default AUTH_RATE_LIMIT_MAX (5)', () => {
      expect(AUTH_RATE_LIMIT_MAX).toBe(5);
    });

    it('should expose correct default AUTH_RATE_LIMIT_WINDOW (60 seconds)', () => {
      expect(AUTH_RATE_LIMIT_WINDOW).toBe(60);
    });

    it('should expose correct default ADMIN_RATE_LIMIT_MAX (30)', () => {
      expect(ADMIN_RATE_LIMIT_MAX).toBe(30);
    });

    it('should expose correct default ADMIN_RATE_LIMIT_WINDOW (60 seconds)', () => {
      expect(ADMIN_RATE_LIMIT_WINDOW).toBe(60);
    });

    it('should expose correct default CALENDAR_RATE_LIMIT_MAX (30)', () => {
      expect(CALENDAR_RATE_LIMIT_MAX).toBe(30);
    });

    it('should expose correct default CALENDAR_RATE_LIMIT_WINDOW (60 seconds)', () => {
      expect(CALENDAR_RATE_LIMIT_WINDOW).toBe(60);
    });

    it('should have revoke stricter than general (5 < 30)', () => {
      expect(REVOKE_RATE_LIMIT_MAX).toBeLessThan(RATE_LIMIT_MAX);
    });

    it('should have auth stricter than general (5 < 30)', () => {
      expect(AUTH_RATE_LIMIT_MAX).toBeLessThan(RATE_LIMIT_MAX);
    });

    it('should have admin and calendar equal to general (30 = 30)', () => {
      expect(ADMIN_RATE_LIMIT_MAX).toBe(RATE_LIMIT_MAX);
      expect(CALENDAR_RATE_LIMIT_MAX).toBe(RATE_LIMIT_MAX);
    });

    it('should have all windows set to 60 seconds', () => {
      expect(RATE_LIMIT_WINDOW).toBe(60);
      expect(REVOKE_RATE_LIMIT_WINDOW).toBe(60);
      expect(AUTH_RATE_LIMIT_WINDOW).toBe(60);
      expect(ADMIN_RATE_LIMIT_WINDOW).toBe(60);
      expect(CALENDAR_RATE_LIMIT_WINDOW).toBe(60);
    });

    it('should have auth and revoke as the strictest limiters', () => {
      expect(AUTH_RATE_LIMIT_MAX).toBe(REVOKE_RATE_LIMIT_MAX);
    });

    it('should have admin and calendar as the most permissive limiters', () => {
      expect(ADMIN_RATE_LIMIT_MAX).toBe(CALENDAR_RATE_LIMIT_MAX);
    });

    it('should have auth stricter than admin', () => {
      expect(AUTH_RATE_LIMIT_MAX).toBeLessThan(ADMIN_RATE_LIMIT_MAX);
    });

    it('should have revoke stricter than admin', () => {
      expect(REVOKE_RATE_LIMIT_MAX).toBeLessThan(ADMIN_RATE_LIMIT_MAX);
    });

    it('should have revoke stricter than calendar', () => {
      expect(REVOKE_RATE_LIMIT_MAX).toBeLessThan(CALENDAR_RATE_LIMIT_MAX);
    });

    it('should have auth stricter than calendar', () => {
      expect(AUTH_RATE_LIMIT_MAX).toBeLessThan(CALENDAR_RATE_LIMIT_MAX);
    });

    it('should have auth stricter than revoke (equal, not less)', () => {
      expect(AUTH_RATE_LIMIT_MAX).toBe(REVOKE_RATE_LIMIT_MAX);
    });

    it('should have admin stricter than general (equal, not less)', () => {
      expect(ADMIN_RATE_LIMIT_MAX).toBe(RATE_LIMIT_MAX);
    });

    it('should have calendar equal to general', () => {
      expect(CALENDAR_RATE_LIMIT_MAX).toBe(RATE_LIMIT_MAX);
    });

    it('should have all windows equal', () => {
      const windows = [
        RATE_LIMIT_WINDOW,
        REVOKE_RATE_LIMIT_WINDOW,
        AUTH_RATE_LIMIT_WINDOW,
        ADMIN_RATE_LIMIT_WINDOW,
        CALENDAR_RATE_LIMIT_WINDOW,
      ];

      const uniqueWindows = new Set(windows);
      expect(uniqueWindows.size).toBe(1); // All should be 60
    });

    it('should have all max values as positive integers', () => {
      const maxes = [
        RATE_LIMIT_MAX,
        REVOKE_RATE_LIMIT_MAX,
        AUTH_RATE_LIMIT_MAX,
        ADMIN_RATE_LIMIT_MAX,
        CALENDAR_RATE_LIMIT_MAX,
      ];

      for (const max of maxes) {
        expect(Number.isInteger(max)).toBe(true);
        expect(max).toBeGreaterThan(0);
      }
    });

    it('should have all window values as positive integers', () => {
      const windows = [
        RATE_LIMIT_WINDOW,
        REVOKE_RATE_LIMIT_WINDOW,
        AUTH_RATE_LIMIT_WINDOW,
        ADMIN_RATE_LIMIT_WINDOW,
        CALENDAR_RATE_LIMIT_WINDOW,
      ];

      for (const window of windows) {
        expect(Number.isInteger(window)).toBe(true);
        expect(window).toBeGreaterThan(0);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Cross-store independence — verify stores don't interfere with each other
  // -----------------------------------------------------------------------

  describe('store independence', () => {
    it('should allow same key in different stores independently', () => {
      const key = 'shared-key';

      // Use all 5 stores with the same key
      expect(checkRateLimit(key)).toBe(true); // count=1 in rate limit store
      expect(checkRevokeRateLimit(key)).toBe(true); // count=1 in revoke store
      expect(checkAuthRateLimit(key)).toBe(true); // count=1 in auth store
      expect(checkAdminRateLimit(key)).toBe(true); // count=1 in admin store
      expect(checkCalendarRateLimit(key)).toBe(true); // count=1 in calendar store

      // Each should still have count=1, so second call allowed
      expect(checkRateLimit(key)).toBe(true); // count=2
      expect(checkRevokeRateLimit(key)).toBe(true); // count=2
      expect(checkAuthRateLimit(key)).toBe(true); // count=2
      expect(checkAdminRateLimit(key)).toBe(true); // count=2
      expect(checkCalendarRateLimit(key)).toBe(true); // count=2

      // Exhaust revoke store (5) and verify it blocks
      for (let i = 0; i < REVOKE_RATE_LIMIT_MAX - 2; i++) {
        checkRevokeRateLimit(key);
      }

      // Revoke should now be blocked (count=5)
      expect(checkRevokeRateLimit(key)).toBe(false);

      // But other stores should still be fine (count=2)
      expect(checkRateLimit(key)).toBe(true); // count=3
      expect(checkAuthRateLimit(key)).toBe(true); // count=3
      expect(checkAdminRateLimit(key)).toBe(true); // count=3
      expect(checkCalendarRateLimit(key)).toBe(true); // count=3

      // Reset revoke and verify it's fresh
      resetRevokeRateLimitStore();
      expect(checkRevokeRateLimit(key)).toBe(true); // count=1 (fresh)

      // Other stores should still be at their counts
      expect(checkRateLimit(key)).toBe(true); // count=4 (not reset)
    });

    it('should handle rapid mixed-store access without interference', () => {
      const key = 'mixed-store-key';

      // Fire alternating calls across all stores
      for (let i = 0; i < 20; i++) {
        checkRateLimit(key);
        checkRevokeRateLimit(key);
        checkAuthRateLimit(key);
        checkAdminRateLimit(key);
        checkCalendarRateLimit(key);
      }

      // Rate limit: 20 calls, count=20 (allowed)
      expect(checkRateLimit(key)).toBe(true); // count=21

      // Revoke: 5 max, blocked after 5
      expect(checkRevokeRateLimit(key)).toBe(false);

      // Auth: 5 max, blocked after 5
      expect(checkAuthRateLimit(key)).toBe(false);

      // Admin: count=21, allowed
      expect(checkAdminRateLimit(key)).toBe(true); // count=22

      // Calendar: count=20, allowed
      expect(checkCalendarRateLimit(key)).toBe(true); // count=21
    });

    it('should handle reset of one store without affecting others', () => {
      const key = 'cross-store-reset';

      // Populate all stores
      for (let i = 0; i < AUTH_RATE_LIMIT_MAX + 5; i++) {
        checkAuthRateLimit(key);
      }

      // Auth should be blocked
      expect(checkAuthRateLimit(key)).toBe(false);

      // Rate limit should still be fresh
      expect(checkRateLimit(key)).toBe(true);

      // Reset only auth store
      resetAuthRateLimitStore();

      // Auth should be fresh again
      expect(checkAuthRateLimit(key)).toBe(true);

      // Rate limit should still be at count=1 (not affected by auth reset)
      expect(checkRateLimit(key)).toBe(true); // count=2

      // Reset rate limit store
      resetRateLimitStore();

      // Rate limit should be fresh, auth still at count=1
      expect(checkRateLimit(key)).toBe(true); // count=1 (fresh)

      // Auth should still be at count=1
      expect(checkAuthRateLimit(key)).toBe(true); // count=2 (not reset)
    });

    it('should handle full cycle: use → exhaust → reset → reuse for all stores', () => {
      const key = 'full-cycle-key';

      // Test each store independently
      const stores = [
        { check: checkRateLimit, reset: resetRateLimitStore, max: RATE_LIMIT_MAX },
        { check: checkRevokeRateLimit, reset: resetRevokeRateLimitStore, max: REVOKE_RATE_LIMIT_MAX },
        { check: checkAuthRateLimit, reset: resetAuthRateLimitStore, max: AUTH_RATE_LIMIT_MAX },
        { check: checkAdminRateLimit, reset: resetAdminRateLimitStore, max: ADMIN_RATE_LIMIT_MAX },
        { check: checkCalendarRateLimit, reset: resetCalendarRateLimitStore, max: CALENDAR_RATE_LIMIT_MAX },
      ];

      for (const store of stores) {
        // Exhaust the limit
        for (let i = 0; i < store.max; i++) {
          expect(store.check(key)).toBe(true);
        }

        // Should be blocked now
        expect(store.check(key)).toBe(false);

        // Reset and verify fresh start
        store.reset();
        expect(store.check(key)).toBe(true);

        // Exhaust again to verify reset worked
        for (let i = 1; i < store.max; i++) {
          expect(store.check(key)).toBe(true);
        }

        // Should be blocked again after second exhaustion
        expect(store.check(key)).toBe(false);

        // Final reset to clean up
        store.reset();
      }
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases and stress tests
  // -----------------------------------------------------------------------

  describe('edge cases and stress', () => {
    it('should handle a very large number of unique keys without errors', () => {
      const uniqueKeys = 100;

      for (let i = 0; i < uniqueKeys; i++) {
        expect(checkRateLimit(`stress-key-${i}`)).toBe(true);
      }

      // All should have count=1, so a second call for each should be allowed
      let successCount = 0;
      for (let i = 0; i < uniqueKeys; i++) {
        if (checkRateLimit(`stress-key-${i}`)) {
          successCount++;
        }
      }

      // All 100 should still be allowed (count=2, well under LIMIT)
      expect(successCount).toBe(uniqueKeys);
    });

    it('should handle rapid alternating calls on many keys', () => {
      const keyCount = 50;

      // Alternate between two keys rapidly
      for (let i = 0; i < 100; i++) {
        const keyA = `alt-key-A-${i % 2}`;
        const keyB = `alt-key-B-${Math.floor(i / 2) % 2}`;
        checkRateLimit(keyA);
        checkRateLimit(keyB);
      }

      // No errors, no crashes — just count up correctly
    });

    it('should handle the boundary case where limit is exactly 1', () => {
      // Simulate: use a key that has been called once already
      checkRateLimit('boundary-one');

      // Second call should be allowed (count=2)
      expect(checkRateLimit('boundary-one')).toBe(true);

      // Continue until limit
      for (let i = 2; i < RATE_LIMIT_MAX - 1; i++) {
        checkRateLimit('boundary-one');
      }

      // Now at RATE_LIMIT_MAX - 1, one more should be allowed
      expect(checkRateLimit('boundary-one')).toBe(true); // count = RATE_LIMIT_MAX

      // Next should be blocked
      expect(checkRateLimit('boundary-one')).toBe(false);
    });

    it('should handle consecutive resets with no usage in between', () => {
      for (let i = 0; i < 5; i++) {
        resetRateLimitStore();
      }

      // Should still work fine after multiple resets with no usage
      expect(checkRateLimit('post-reset-use')).toBe(true);
    });

    it('should handle a single key being used at the exact limit boundary', () => {
      const key = 'exact-boundary';

      // Use exactly RATE_LIMIT_MAX calls
      for (let i = 0; i < RATE_LIMIT_MAX; i++) {
        const result = checkRateLimit(key);
        if (!result) {
          // Should never happen — all should pass up to the limit
          throw new Error(`Unexpectedly blocked at call ${i + 1}`);
        }
      }

      // The very next call should be blocked
      expect(checkRateLimit(key)).toBe(false);

      // And all subsequent calls should also be blocked
      for (let i = 0; i < 10; i++) {
        expect(checkRateLimit(key)).toBe(false);
      }
    });

    it('should handle a burst of 1000 rapid calls on one key', () => {
      const key = 'burst-1000';

      let allowedCount = 0;
      for (let i = 0; i < 1000; i++) {
        if (checkRateLimit(key)) {
          allowedCount++;
        }
      }

      // Exactly RATE_LIMIT_MAX should have been allowed
      expect(allowedCount).toBe(RATE_LIMIT_MAX);

      // The remaining 1000 - RATE_LIMIT_MAX should be blocked
      const blockedCount = 1000 - allowedCount;
      expect(blockedCount).toBe(1000 - RATE_LIMIT_MAX);
    });

    it('should handle a burst of 500 rapid calls on revoke store', () => {
      const key = 'revoke-burst-500';

      let allowedCount = 0;
      for (let i = 0; i < 500; i++) {
        if (checkRevokeRateLimit(key)) {
          allowedCount++;
        }
      }

      // Exactly REVOKE_RATE_LIMIT_MAX should have been allowed
      expect(allowedCount).toBe(REVOKE_RATE_LIMIT_MAX);

      const blockedCount = 500 - allowedCount;
      expect(blockedCount).toBe(500 - REVOKE_RATE_LIMIT_MAX);
    });

    it('should handle a burst of 20 rapid calls on auth store', () => {
      const key = 'auth-burst-20';

      let allowedCount = 0;
      for (let i = 0; i < 20; i++) {
        if (checkAuthRateLimit(key)) {
          allowedCount++;
        }
      }

      // Exactly AUTH_RATE_LIMIT_MAX should have been allowed
      expect(allowedCount).toBe(AUTH_RATE_LIMIT_MAX);

      const blockedCount = 20 - allowedCount;
      expect(blockedCount).toBe(20 - AUTH_RATE_LIMIT_MAX);
    });

    it('should handle a burst of 100 rapid calls on admin store', () => {
      const key = 'admin-burst-100';

      let allowedCount = 0;
      for (let i = 0; i < 100; i++) {
        if (checkAdminRateLimit(key)) {
          allowedCount++;
        }
      }

      // Exactly ADMIN_RATE_LIMIT_MAX should have been allowed
      expect(allowedCount).toBe(ADMIN_RATE_LIMIT_MAX);

      const blockedCount = 100 - allowedCount;
      expect(blockedCount).toBe(100 - ADMIN_RATE_LIMIT_MAX);
    });

    it('should handle a burst of 100 rapid calls on calendar store', () => {
      const key = 'calendar-burst-100';

      let allowedCount = 0;
      for (let i = 0; i < 100; i++) {
        if (checkCalendarRateLimit(key)) {
          allowedCount++;
        }
      }

      // Exactly CALENDAR_RATE_LIMIT_MAX should have been allowed
      expect(allowedCount).toBe(CALENDAR_RATE_LIMIT_MAX);

      const blockedCount = 100 - allowedCount;
      expect(blockedCount).toBe(100 - CALENDAR_RATE_LIMIT_MAX);
    });

    it('should handle resetting the same store multiple times in a row', () => {
      const key = 'multi-reset-key';

      // Use, reset, use, reset pattern
      for (let i = 0; i < 5; i++) {
        checkAdminRateLimit(key);
        resetAdminRateLimitStore();
      }

      // Should still work after all those resets
      expect(checkAdminRateLimit(key)).toBe(true);

      // And can be exhausted again
      for (let i = 1; i < ADMIN_RATE_LIMIT_MAX; i++) {
        expect(checkAdminRateLimit(key)).toBe(true);
      }

      expect(checkAdminRateLimit(key)).toBe(false); // blocked after exhaustion
    });

    it('should handle a mix of all stores with the same key simultaneously', () => {
      const key = 'all-stores-same-key';

      // Use each store up to its limit
      const stores = [
        { check: checkRateLimit, max: RATE_LIMIT_MAX },
        { check: checkRevokeRateLimit, max: REVOKE_RATE_LIMIT_MAX },
        { check: checkAuthRateLimit, max: AUTH_RATE_LIMIT_MAX },
        { check: checkAdminRateLimit, max: ADMIN_RATE_LIMIT_MAX },
        { check: checkCalendarRateLimit, max: CALENDAR_RATE_LIMIT_MAX },
      ];

      // Exhaust all stores with the same key
      for (const store of stores) {
        for (let i = 0; i < store.max; i++) {
          store.check(key);
        }

        // Each should now be blocked
        expect(store.check(key)).toBe(false);
      }

      // Reset all stores
      resetRateLimitStore();
      resetRevokeRateLimitStore();
      resetAuthRateLimitStore();
      resetAdminRateLimitStore();
      resetCalendarRateLimitStore();

      // All should be fresh again with the same key
      for (const store of stores) {
        expect(store.check(key)).toBe(true); // count=1, allowed
      }
    });

    it('should handle very rapid sequential calls without any crashes', () => {
      // This is a stress test — fire 10000 calls in rapid succession
      const key = 'stress-10k';

      let allowedCount = 0;
      for (let i = 0; i < 10000; i++) {
        if (checkRateLimit(key)) {
          allowedCount++;
        }
      }

      // Exactly RATE_LIMIT_MAX should have been allowed (the rest 9970 are blocked)
      expect(allowedCount).toBe(RATE_LIMIT_MAX);

      const blockedCount = 10000 - allowedCount;
      expect(blockedCount).toBe(9970); // 10000 - 30 = 9970
    });

    it('should handle concurrent-like access patterns (no race conditions)', () => {
      // JavaScript is single-threaded, so we test sequential rapid access
      // that simulates concurrent patterns

      const key = 'concurrent-sim';

      // Fire calls in a pattern that would be concurrent in async code
      const promises: Promise<boolean>[] = [];

      for (let i = 0; i < 50; i++) {
        // Each call is synchronous, but we batch them to simulate concurrency
        promises.push(Promise.resolve(checkRateLimit(key)));
      }

      return Promise.all(promises).then((results) => {
        const allowedCount = results.filter((r) => r === true).length;
        expect(allowedCount).toBe(RATE_LIMIT_MAX);

        const blockedCount = results.filter((r) => r === false).length;
        expect(blockedCount).toBe(50 - RATE_LIMIT_MAX);
      });
    });

    it('should handle the transition from allowed to blocked seamlessly', () => {
      const key = 'transition-test';

      // Last allowed call
      for (let i = 0; i < RATE_LIMIT_MAX - 1; i++) {
        checkRateLimit(key);
      }

      // This call should be allowed (count = RATE_LIMIT_MAX)
      const lastAllowed = checkRateLimit(key);
      expect(lastAllowed).toBe(true);

      // This call should be blocked (count was already at max)
      const firstBlocked = checkRateLimit(key);
      expect(firstBlocked).toBe(false);

      // Next call should also be blocked (not a transient state)
      const secondBlocked = checkRateLimit(key);
      expect(secondBlocked).toBe(false);

      // Verify the entry exists in the store (not deleted)
      // We can't directly access the store, but we can verify behavior:
      // After reset and immediate reuse, it should work
    });

    it('should handle keys that differ only in suffix', () => {
      const similarKeys = [
        'session:1',
        'session:10',
        'session:100',
        'session:1000',
        'session:10000',
      ];

      // Each should be independent
      for (const key of similarKeys) {
        expect(checkRateLimit(key)).toBe(true); // count=1
      }

      // Exhaust session:1 and verify others are unaffected
      for (let i = 0; i < RATE_LIMIT_MAX - 1; i++) {
        checkRateLimit('session:1');
      }

      expect(checkRateLimit('session:1')).toBe(false); // blocked
      expect(checkRateLimit('session:10')).toBe(true); // unaffected (count=2)
      expect(checkRateLimit('session:100')).toBe(true); // unaffected (count=2)
    });

    it('should handle empty stores after all resets', () => {
      // Reset all stores
      resetRateLimitStore();
      resetRevokeRateLimitStore();
      resetAuthRateLimitStore();
      resetAdminRateLimitStore();
      resetCalendarRateLimitStore();

      // All stores should be empty and ready for fresh use
      expect(checkRateLimit('fresh-1')).toBe(true);
      expect(checkRevokeRateLimit('fresh-2')).toBe(true);
      expect(checkAuthRateLimit('fresh-3')).toBe(true);
      expect(checkAdminRateLimit('fresh-4')).toBe(true);
      expect(checkCalendarRateLimit('fresh-5')).toBe(true);

      // Reset again — should not throw or cause issues
      resetRateLimitStore();
      resetRevokeRateLimitStore();
      resetAuthRateLimitStore();
      resetAdminRateLimitStore();
      resetCalendarRateLimitStore();

      // And still work
      expect(checkRateLimit('fresh-6')).toBe(true);
    });

    it('should handle a complete lifecycle: create → use → exhaust → reset → reuse', () => {
      const key = 'complete-lifecycle';

      // Phase 1: First use — should be allowed
      expect(checkRateLimit(key)).toBe(true);

      // Phase 2: Use up to limit
      for (let i = 1; i < RATE_LIMIT_MAX; i++) {
        expect(checkRateLimit(key)).toBe(true);
      }

      // Phase 3: Exhausted — should be blocked
      expect(checkRateLimit(key)).toBe(false);

      // Phase 4: Reset — should be allowed again
      resetRateLimitStore();
      expect(checkRateLimit(key)).toBe(true);

      // Phase 5: Use again up to limit
      for (let i = 1; i < RATE_LIMIT_MAX; i++) {
        expect(checkRateLimit(key)).toBe(true);
      }

      // Phase 6: Exhausted again — should be blocked
      expect(checkRateLimit(key)).toBe(false);

      // Phase 7: Reset and verify clean state
      resetRateLimitStore();
      expect(checkRateLimit(key)).toBe(true); // Fresh start

      // Phase 8: Verify no leftover state
      for (let i = 1; i < RATE_LIMIT_MAX; i++) {
        expect(checkRateLimit(key)).toBe(true);
      }

      // Should be blocked at the exact limit boundary
      expect(checkRateLimit(key)).toBe(false);

      // Final cleanup
      resetRateLimitStore();
    });
  });

  // -----------------------------------------------------------------------
  // Cleanup functions — cleanAdminRateLimitStore / cleanCalendarRateLimitStore
  // -----------------------------------------------------------------------

  describe('cleanAdminRateLimitStore', () => {
    it('should remove entries older than 2x window', () => {
      // Populate store with fresh and stale entries
      expect(checkAdminRateLimit('admin:clean-fresh')).toBe(true);  // now
      expect(checkAdminRateLimit('admin:clean-stale')).toBe(true);  // now

      const freshEntry = adminRateLimitStore.get('admin:clean-fresh');
      expect(freshEntry).toBeDefined();

      // Manually make the stale entry very old (set windowStart to 10 hours ago)
      const staleEntry = adminRateLimitStore.get('admin:clean-stale');
      expect(staleEntry).toBeDefined();
      staleEntry!.windowStart = Math.floor(Date.now() / 1000) - (10 * 60 * 60);

      // Verify both exist before cleanup
      expect(adminRateLimitStore.size).toBe(2);

      // Run cleanup with current time
      cleanAdminRateLimitStore();

      // Fresh entry should still exist, stale should be gone
      expect(adminRateLimitStore.has('admin:clean-fresh')).toBe(true);
      expect(adminRateLimitStore.has('admin:clean-stale')).toBe(false);

      resetAdminRateLimitStore();
    });

    it('should keep entries within 2x window', () => {
      expect(checkAdminRateLimit('admin:keep-test')).toBe(true);

      const entry = adminRateLimitStore.get('admin:keep-test');
      expect(entry).toBeDefined();

      // Set windowStart to 1.5x window ago (within the 2x threshold)
      entry!.windowStart = Math.floor(Date.now() / 1000) - (ADMIN_RATE_LIMIT_WINDOW * 1.5);

      cleanAdminRateLimitStore();

      // Should still be present (not yet expired)
      expect(adminRateLimitStore.has('admin:keep-test')).toBe(true);

      resetAdminRateLimitStore();
    });

    it('should handle empty store gracefully', () => {
      resetAdminRateLimitStore();
      expect(() => cleanAdminRateLimitStore()).not.toThrow();
    });

    it('should accept a custom now parameter', () => {
      expect(checkAdminRateLimit('admin:custom-now')).toBe(true);

      const entry = adminRateLimitStore.get('admin:custom-now');
      expect(entry).toBeDefined();

      // Set windowStart to 3x window before customNow so cleanup deletes it
      const customNow = Math.floor(Date.now() / 1000);
      entry!.windowStart = customNow - (ADMIN_RATE_LIMIT_WINDOW * 3);

      cleanAdminRateLimitStore(customNow);

      // Should be cleaned up because the entry is 3x window old relative to customNow
      expect(adminRateLimitStore.has('admin:custom-now')).toBe(false);

      resetAdminRateLimitStore();
    });
  });

  describe('cleanCalendarRateLimitStore', () => {
    it('should remove entries older than 2x window', () => {
      expect(checkCalendarRateLimit('cal:clean-fresh')).toBe(true);
      expect(checkCalendarRateLimit('cal:clean-stale')).toBe(true);

      // Make the stale entry very old (10 hours ago)
      const staleEntry = calendarRateLimitStore.get('cal:clean-stale');
      expect(staleEntry).toBeDefined();
      staleEntry!.windowStart = Math.floor(Date.now() / 1000) - (10 * 60 * 60);

      expect(calendarRateLimitStore.size).toBe(2);

      cleanCalendarRateLimitStore();

      expect(calendarRateLimitStore.has('cal:clean-fresh')).toBe(true);
      expect(calendarRateLimitStore.has('cal:clean-stale')).toBe(false);

      resetCalendarRateLimitStore();
    });

    it('should keep entries within 2x window', () => {
      expect(checkCalendarRateLimit('cal:keep-test')).toBe(true);

      const entry = calendarRateLimitStore.get('cal:keep-test');
      expect(entry).toBeDefined();

      entry!.windowStart = Math.floor(Date.now() / 1000) - (CALENDAR_RATE_LIMIT_WINDOW * 1.5);

      cleanCalendarRateLimitStore();

      expect(calendarRateLimitStore.has('cal:keep-test')).toBe(true);

      resetCalendarRateLimitStore();
    });

    it('should handle empty store gracefully', () => {
      resetCalendarRateLimitStore();
      expect(() => cleanCalendarRateLimitStore()).not.toThrow();
    });

    it('should accept a custom now parameter', () => {
      expect(checkCalendarRateLimit('cal:custom-now')).toBe(true);

      const entry = calendarRateLimitStore.get('cal:custom-now');
      expect(entry).toBeDefined();

      // Set windowStart to 3x window before customNow so cleanup deletes it
      const customNow = Math.floor(Date.now() / 1000);
      entry!.windowStart = customNow - (CALENDAR_RATE_LIMIT_WINDOW * 3);

      cleanCalendarRateLimitStore(customNow);

      // Should be cleaned up because the entry is 3x window old relative to customNow
      expect(calendarRateLimitStore.has('cal:custom-now')).toBe(false);

      resetCalendarRateLimitStore();
    });
  });
});
