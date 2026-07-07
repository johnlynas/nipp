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
        // Clear all session cookie variants on the client side.
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
