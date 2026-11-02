/**
 * BetterAuth client-side utility.
 */

import { createAuthClient } from 'better-auth/client';
import { organizationClient } from 'better-auth/client/plugins';
import { useSyncExternalStore } from 'react';
import { clearPayloadKey } from './payload-key-manager';

export const authClient = createAuthClient({
  plugins: [
    // Enable Teams mode on the client side
    organizationClient({
      teams: {
        enabled: true,
      },
    }),
  ],
});

// Eager session hydrate (browser only). Better-populated-by-subscriber-only:
// better-auth 1.7.x fills $session via a nanostores onMount fetch (/get-session)
// that fires ONLY while a subscriber is mounted during its keep-mount window.
// During Next.js client-side navigations the tree unmounts/remounts in between —
// if nothing subscribes inside that window (timing-dependent; widens when the
// framework renders slower, e.g. Next 16) the fetch never fires and the atom
// sits at {data: null} forever → UI widgets that read it silently render null
// (e.g. TopBarUserIdentityChip — "pill missing after re-login"). Kick the same
// refetch once at module load so a fetch is always in flight before any component
// reads the atom, regardless of subscriber timing. Deduped internally: if a
// fetch is already in flight or data is fresh, this is a no-op.
if (typeof window !== 'undefined') {
  const state = authClient.useSession.get() as { isPending?: boolean; refetch?: () => Promise<void> };
  if (state?.isPending && typeof state.refetch === 'function') {
    void state.refetch();
  }
}

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


