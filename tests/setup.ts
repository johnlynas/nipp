/**
 * Test setup file.
 *
 * Configures global matchers and common mocks for the test environment.
 */

// Pin the timezone so date/time assertions are deterministic regardless of the
// machine's local zone (e.g. Europe/London GMT/BST). Must be set before any
// Date arithmetic in tests; Node re-reads TZ on each operation.
process.env.TZ = 'UTC';

// Load .env.test BEFORE any test file imports app code: lib/env resolves
// DATABASE_URL at import time, and without it the Prisma client falls back to
// the hardcoded test fixture DSN (user `test`) which does not exist on the
// local Postgres. dotenv never overrides vars already set in the environment,
// so an explicit `DATABASE_URL=... npm run test:integration` still wins.
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.test') });

import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

/**
 * Suppress act() warnings from async form submissions.
 *
 * In React 19 + vitest, microtask-driven state updates (e.g. form reset
 * after an async onSubmit) fire outside of RTL's act() wrapper because
 * microtasks always drain before the next macrotask. These warnings are
 * harmless — the tests still assert correct behaviour.
 */
const originalWarn = console.warn;
const originalError = console.error;
console.warn = (...args: unknown[]) => {
  const msg = String(args[0] ?? '');
  if (msg.includes('act(')) return;
  originalWarn(...args);
};
console.error = (...args: unknown[]) => {
  const msg = String(args[0] ?? '');
  if (msg.includes('act(')) return;
  originalError(...args);
};

/**
 * Global Mocks
 */

// We wrap the browser-specific mocks in a check to ensure they only run
// when a DOM environment (like jsdom) is actually present.
if (typeof window !== 'undefined') {
  // Mock window.matchMedia which is often used by UI libraries (like Radix/Shadcn)
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(), // Deprecated
      removeListener: vi.fn(), // Deprecated
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  // Mock IntersectionObserver (common in Next.js/modern UI)
  class MockIntersectionObserver {
    readonly root: Element | null = null;
    readonly rootMargin: string = '';
    readonly thresholds: ReadonlyArray<number> = [];
    disconnect = vi.fn();
    observe = vi.fn();
    unobserve = vi.fn();
    takeRecords = vi.fn();
  }

  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
}
