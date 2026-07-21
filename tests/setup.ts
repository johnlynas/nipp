/**
 * Test setup file.
 *
 * Configures global matchers and common mocks for the test environment.
 */

import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

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
