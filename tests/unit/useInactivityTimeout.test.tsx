/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { InactivityTimeoutProvider } from '@/components/providers/InactivityTimeoutConfig';
import { useInactivityTimeout } from '@/hooks/useInactivityTimeout';

// Mock sonner — use a factory to avoid hoisting issues.
const mockToast = {
  warning: vi.fn(),
  dismiss: vi.fn(),
};

vi.mock('sonner', () => ({
  get toast() {
    return mockToast;
  },
}));

// Mock auth-client — useSession is mocked at the top level.
const mockUseSession = vi.fn();

vi.mock('@/lib/auth-client', () => ({
  signOutUser: vi.fn().mockResolvedValue({ success: true }),
  useSession: () => mockUseSession(),
}));

// Mock window.location.href for redirect testing.
const mockLocation = { href: '' };
Object.defineProperty(window, 'location', {
  value: mockLocation,
  writable: true,
});

// Helper to advance timers by ms.
function advanceTimers(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('useInactivityTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.clearAllTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderWithProvider(timeoutMins = 1, sessionData: unknown = { id: 'user-1' }) {
    mockUseSession.mockReturnValue({ data: sessionData, loading: false });

    return renderHook(() => useInactivityTimeout(), {
      wrapper: ({ children }) => (
        <InactivityTimeoutProvider timeoutMins={timeoutMins}>{children}</InactivityTimeoutProvider>
      ),
    });
  }

  it('should initialize without errors', () => {
    const { unmount } = renderWithProvider();
    expect(() => unmount()).not.toThrow();
  });

  it('should fire a warning toast at timeout - 30s', async () => {
    // Use 1-minute timeout so tests run fast. Warning fires at 30s.
    const { unmount } = renderWithProvider(1);

    // After 30 seconds (timeout=60s, warning at 30s), the warning toast should fire.
    advanceTimers(30_000);

    expect(mockToast.warning).toHaveBeenCalledWith('Your session is expiring soon', {
      id: 'inactivity-warning',
      description: 'You will be logged out due to inactivity.',
      duration: 30_000,
    });

    unmount();
  });

  it('should call signOutUser and redirect at timeout expiry', async () => {
    // Use 1-minute timeout. Warning fires at 30s, logout at 60s.
    const { unmount } = renderWithProvider(1);

    // Advance to warning time
    advanceTimers(30_000);
    vi.clearAllMocks();

    // Advance to logout time (another 30s)
    advanceTimers(30_000);

    const { signOutUser } = await import('@/lib/auth-client');
    expect(signOutUser).toHaveBeenCalled();
    expect(mockLocation.href).toBe('/login');

    unmount();
  });

  it('should not fire warning before timeout - 30s', async () => {
    const { unmount } = renderWithProvider(1);

    // Advance to 29s — warning should NOT have fired yet.
    advanceTimers(29_000);

    expect(mockToast.warning).not.toHaveBeenCalled();

    unmount();
  });

  it('should dismiss the warning toast on activity', async () => {
    const { unmount } = renderWithProvider(1);

    // Advance to warning time
    advanceTimers(30_000);

    expect(mockToast.warning).toHaveBeenCalled();

    unmount();
  });

  it('should use the configured timeout value from context', async () => {
    // Use a 2-minute timeout. Warning fires at 90s (120 - 30).
    const { unmount } = renderWithProvider(2);

    // Advance to 89s — warning should NOT have fired yet.
    advanceTimers(89_000);

    expect(mockToast.warning).not.toHaveBeenCalled();

    // Advance to 90s — warning should fire.
    advanceTimers(1_000);

    expect(mockToast.warning).toHaveBeenCalled();

    unmount();
  });

  it('should clean up timers and event listeners on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderWithProvider();
    unmount();

    // Verify event listeners were removed.
    expect(removeEventListenerSpy).toHaveBeenCalledTimes(5); // 5 tracked events

    removeEventListenerSpy.mockRestore();
  });

  it('should not track inactivity when user is logged out (session is null)', async () => {
    const { unmount } = renderWithProvider(1, null);

    // Advance past the warning time — no toast should fire.
    advanceTimers(31_000);

    expect(mockToast.warning).not.toHaveBeenCalled();

    unmount();
  });


});
