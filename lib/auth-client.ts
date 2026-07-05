/**
 * BetterAuth client-side utility.
 */

import { createAuthClient } from 'better-auth/client';

export const authClient = createAuthClient();

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
 */
export async function signOutUser() {
  const result = await authClient.signOut({
    fetchOptions: {
      onSuccess: () => {
        // Clear all session cookie variants on the client side
        document.cookie = 'better-auth.session_token=; path=/; max-age=0; secure; samesite=lax';
        document.cookie = 'better-auth-session_token=; path=/; max-age=0; secure; samesite=lax';
      },
    },
  });

  if (result.error) {
    return { error: result.error.message || 'Sign out failed' };
  }

  return { success: true };
}
