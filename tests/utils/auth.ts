/**
 * Authentication test helpers.
 */

import { auth } from '@/lib/auth';

/**
 * Create a test user for authentication tests.
 */
export async function createTestUser(email: string, password: string, name?: string) {
  // TODO: Implement when BetterAuth test-utils is fully integrated
  return { email, password, name: name || email };
}

/**
 * Create an authenticated session for testing.
 */
export async function createTestSession(userId: string) {
  // TODO: Implement when BetterAuth test-utils is fully integrated
  return null;
}

/**
 * Make an authenticated request for testing.
 */
export async function authenticatedFetch(url: string, options?: RequestInit) {
  // TODO: Implement when BetterAuth test-utils is fully integrated
  return fetch(url, options);
}
