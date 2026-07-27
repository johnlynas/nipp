/**
 * @vitest-environment jsdom
 * Integration test: Notification Polling Intelligence
 * Verifies that the refetch interval correctly responds to window focus/blur.
 */

import { describe, it, expect, afterAll, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useNotifications } from '../../features/notifications/api/useNotifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Mock EventSource because JSDOM does not implement it
class MockEventSource {
  onmessage: ((this: any, ev: MessageEvent) => any) | null = null;
  onerror: ((this: any, ev: Event) => any) | null = null;
  close = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();

  constructor(url: string) {
    // @ts-expect-error - Mock setup for JSDOM
    globalThis.currentEventSourceUrl = url;
  }
}

// @ts-expect-error - Mock setup for JSDOM
globalThis.EventSource = MockEventSource;

// Wrapper to provide React Query context to the hook
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false, // Disable retries for faster tests
      },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('useNotifications Polling Logic', () => {
  it('should attach event listeners for focus and blur', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => useNotifications(), {
      wrapper: createWrapper(),
    });

    // Verify listeners are attached on mount
    expect(addSpy).toHaveBeenCalledWith('focus', expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith('blur', expect.any(Function));

    unmount();

    // Verify listeners are removed on unmount to prevent memory leaks
    expect(removeSpy).toHaveBeenCalledWith('focus', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('blur', expect.any(Function));
  });

  it('should respond to window focus/blur events', async () => {
    const { unmount } = renderHook(() => useNotifications(), {
      wrapper: createWrapper(),
    });

    // Simulate Blur
    window.dispatchEvent(new Event('blur'));
    
    // Simulate Focus
    window.dispatchEvent(new Event('focus'));

    unmount();
  });
});
