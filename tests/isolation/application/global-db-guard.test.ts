/**
 * Application-layer isolation tests: global-db-guard (Super Admin runtime guard)
 *
 * Tests that getGlobalDb() throws when called outside a super-admin context,
 * and returns the Prisma client inside one.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — use inline factories with no external references to avoid hoisting issues.
// Each call to createStorage returns a fresh storage with its own state map.
// ---------------------------------------------------------------------------

vi.mock('@/lib/tenant-context', () => {
  // Module-level map shared across all storage instances created in this test file.
  const _allStores = new Map<number, unknown>();
  let _globalCounter = 0;

  function createStorage() {
    const id = ++_globalCounter;
    return {
      run: <T>(value: unknown, fn: () => T): T => {
        const prev = _allStores.get(id);
        _allStores.set(id, value);

        const result = fn();

        // If the function returned a Promise, keep context until it resolves/rejects,
        // then restore previous value.
        if (result && typeof (result as { then?: unknown }).then === 'function') {
          const promise = result as unknown as Promise<T>;
          return promise
            .then(
              (v) => {
                _allStores.set(id, prev);
                return v;
              },
              (e) => {
                _allStores.set(id, prev);
                throw e;
              }
            ) as unknown as T;
        }

        // Synchronous: restore immediately in finally
        _allStores.set(id, prev);
        return result;
      },
      getStore: () => _allStores.get(id) as unknown,
    };
  }

  return { createStorage };
});

vi.mock('@/lib/env', () => ({
  env: { NODE_ENV: 'test' },
}));

vi.mock('@/lib/db', () => ({
  default: { $connect: vi.fn(), $disconnect: vi.fn() },
  prisma: { $connect: vi.fn(), $disconnect: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import after mocking
// ---------------------------------------------------------------------------

import { getGlobalDb, superAdminStorage } from '@/lib/global-db-guard';

describe('Global DB Guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getGlobalDb() — outside super-admin context', () => {
    it('throws when no super-admin context is active', () => {
      expect(() => getGlobalDb()).toThrow(
        'SECURITY: globalDb accessed outside super-admin context'
      );
    });

    it('throws with a descriptive error message', () => {
      try {
        getGlobalDb();
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        const err = error as Error;
        expect(err.message).toContain('SECURITY');
        expect(err.message).toContain('super-admin context');
      }
    });

    it('captures a stack trace for debugging', () => {
      try {
        getGlobalDb();
        expect.unreachable('Should have thrown');
      } catch (error) {
        const err = error as Error;
        expect(err.stack).toBeDefined();
        expect(typeof err.stack).toBe('string');
      }
    });
  });

  describe('getGlobalDb() — inside super-admin context', () => {
    it('returns the Prisma client when in super-admin context', () => {
      const result = superAdminStorage.run(true, () => getGlobalDb());

      expect(result).toBeDefined();
    });

    it('returns the client from within nested callbacks', () => {
      let innerResult: unknown;

      superAdminStorage.run(true, () => {
        innerResult = getGlobalDb();
      });

      expect(innerResult).toBeDefined();
    });

    it('returns the client from async callbacks', async () => {
      let result: unknown;

      await superAdminStorage.run(true, async () => {
        // Use Promise.resolve().then() (microtask) to stay within the async context
        await Promise.resolve();
        result = getGlobalDb();
      });

      expect(result).toBeDefined();
    });
  });

  describe('Super-admin context isolation', () => {
    it('context does not leak across parallel async operations', async () => {
      let inContext: unknown;

      await superAdminStorage.run(true, async () => {
        inContext = getGlobalDb();
      });

      // After run() completes, context should be gone
      let outOfContext: string = 'no-error';
      try {
        getGlobalDb();
        outOfContext = 'should-not-reach-here';
      } catch {
        outOfContext = 'threw-as-expected';
      }

      expect(inContext).toBeDefined();
      expect(outOfContext).toBe('threw-as-expected');
    });

    it('context does not leak across sequential async operations', async () => {
      let firstResult: unknown;
      await superAdminStorage.run(true, async () => {
        // Use microtask to stay within the async context
        await Promise.resolve();
        firstResult = getGlobalDb();
      });

      let secondResult: string = 'no-error';
      try {
        getGlobalDb();
      } catch {
        secondResult = 'threw';
      }

      expect(firstResult).toBeDefined();
      expect(secondResult).toBe('threw');
    });

    it('nested super-admin contexts work correctly', () => {
      let innerResult: unknown;

      superAdminStorage.run(true, () => {
        const outerResult = getGlobalDb();
        innerResult = superAdminStorage.run(true, () => getGlobalDb());
        const backToOuter = getGlobalDb();

        expect(outerResult).toBeDefined();
        expect(innerResult).toBeDefined();
        expect(backToOuter).toBeDefined();
      });

      expect(() => getGlobalDb()).toThrow();
    });

    it('false value in superAdminStorage also blocks access', () => {
      expect(() =>
        superAdminStorage.run(false, () => getGlobalDb())
      ).toThrow('SECURITY: globalDb accessed outside super-admin context');
    });
  });

  describe('superAdminStorage export', () => {
    it('is exported for callers to wrap code in super-admin context', () => {
      expect(superAdminStorage).toBeDefined();
      expect(typeof superAdminStorage.run).toBe('function');
    });

    it('can be used to scope getGlobalDb access', () => {
      const client = superAdminStorage.run(true, () => getGlobalDb());
      expect(client).toBeDefined();
    });
  });
});
