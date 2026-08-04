/**
 * BetterAuth client-side utility.
 */

import { createAuthClient } from 'better-auth/client';
import { useSyncExternalStore } from 'react';
import { clearPayloadKey } from './payload-key-manager';

export const authClient = createAuthClient();

/**
 * Stable empty session object used as the server snapshot for useSyncExternalStore.
 * Must be a module-level constant so Object.is comparison never sees a "change".
 */
const EMPTY_SERVER_SNAPSHOT = { data: null, error: null, isPending: true } as { data: unknown; error: unknown; isPending: boolean };

/**
 * React hook to get the current session.
 * Subscribes to BetterAuth's $session nanostore atom via useSyncExternalStore.
 */
export function useSession() {
  const sessionAtom = authClient.useSession;

  const atomValue = useSyncExternalStore(
    (callback) => sessionAtom.subscribe(callback),
    () => sessionAtom.get(),
    () => EMPTY_SERVER_SNAPSHOT // stable server snapshot (module-level constant)
  );

  return {
    data: atomValue?.data ?? null,
    loading: !!atomValue?.isPending,
  };
}

/**
 * Sign in with email/password. Returns { success: true } on success,
 * or { error: string } on failure.
 */
export async function signInEmail(email: string, password: string) {
  const result = await authClient.signIn.email({ email, password });

  // BetterFetchResponse: success when there's no error
  if (result.error) {
    return { error: result.error.message || 'Invalid credentials' };
  }

  return { success: true };
}

/**
 * Sign out the current session. Returns { success: true } on success,
 * or { error: string } on failure.
 *
 * On logout, this:
 * 1. Revokes server-side payload keys for the session
 * 2. Clears client-side cached payload key
 * 3. Invalidates all BetterAuth session cookies
 */
export async function signOutUser() {
  // Step 1: Revoke server-side payload keys (best-effort)
  try {
    await fetch('/api/security/payload-key/revoke', { method: 'POST' });
  } catch {
    // Non-fatal — server may not have the endpoint yet
  }

  const result = await authClient.signOut({
    fetchOptions: {
      onSuccess: () => {
        // Step 2: Clear client-side cached payload key
        void clearPayloadKey();

        // Step 3: Clear all session cookie variants on the client side.
        // BetterAuth prefixes with __Secure- when BETTER_AUTH_URL uses https://,
        // so we clear both prefixed and unprefixed variants.
        document.cookie = '__Secure-better-auth.session_token=; path=/; max-age=0';
        document.cookie = 'better-auth.session_token=; path=/; max-age=0';
        document.cookie = '__Secure-better-auth-session_token=; path=/; max-age=0';
        document.cookie = 'better-auth-session_token=; path=/; max-age=0';
      },
    },
  });

  if (result.error) {
    return { error: result.error.message || 'Sign out failed' };
  }

  return { success: true };
}


