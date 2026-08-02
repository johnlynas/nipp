'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useInactivityTimeoutConfig } from '@/components/providers/InactivityTimeoutConfig';
import { signOutUser } from '@/lib/auth-client';
import { useSession } from '@/lib/auth-client';

const WARNING_SECONDS_BEFORE_LOGOUT = 30;
const INACTIVITY_EVENTS = ['mousemove', 'click', 'keydown', 'scroll', 'touchstart'] as const;

/**
 * Tracks user activity and triggers auto-logout after the configured timeout.
 * Displays a warning toast 30 seconds before logout.
 * Only active when the user has an authenticated session.
 * Uses useRef to stabilize function identities and prevent event listener thrashing.
 */
export function useInactivityTimeout() {
  const { timeoutMins } = useInactivityTimeoutConfig();
  const { data: session } = useSession();

  // Stabilize timeout value so useEffect doesn't rebuild listeners on every render.
  const timeoutMinsRef = useRef(timeoutMins);
  timeoutMinsRef.current = timeoutMins;

  // Stabilize performLogout so the effect doesn't tear down listeners on every render.
  const performLogoutRef = useRef(async () => {
    await signOutUser();
    window.location.href = '/login';
  });

  useEffect(() => {
    // Only track inactivity when the user has an active session.
    if (!session) {
      return;
    }

    const timeoutMs = timeoutMinsRef.current * 60 * 1000;
    const warningMs = timeoutMs - WARNING_SECONDS_BEFORE_LOGOUT * 1000;

    let warningTimer: ReturnType<typeof setTimeout> | null = null;
    let logoutTimer: ReturnType<typeof setTimeout> | null = null;

    function clearTimers() {
      if (warningTimer !== null) {
        clearTimeout(warningTimer);
        warningTimer = null;
      }
      if (logoutTimer !== null) {
        clearTimeout(logoutTimer);
        logoutTimer = null;
      }
    }

    function resetTimer() {
      clearTimers();
      toast.dismiss('inactivity-warning');

      warningTimer = setTimeout(() => {
        toast.warning('Your session is expiring soon', {
          id: 'inactivity-warning',
          description: 'You will be logged out due to inactivity.',
          duration: WARNING_SECONDS_BEFORE_LOGOUT * 1000,
        });

        logoutTimer = setTimeout(() => {
          performLogoutRef.current();
        }, WARNING_SECONDS_BEFORE_LOGOUT * 1000);
      }, warningMs);
    }

    // Attach event listeners once — ref-stabilized functions prevent thrashing.
    for (const event of INACTIVITY_EVENTS) {
      window.addEventListener(event, resetTimer);
    }

    // Start the initial timer.
    resetTimer();

    return () => {
      clearTimers();
      for (const event of INACTIVITY_EVENTS) {
        window.removeEventListener(event, resetTimer);
      }
    };
    // Intentionally empty dependency array: ref-stabilized functions prevent
    // effect from tearing down/rebuilding event listeners on every render.
  }, [session]);
}
