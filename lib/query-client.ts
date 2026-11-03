/**
 * React Query <QueryClient> registry.
 *
 * The single app-level QueryClient is created in app/providers.tsx; small
 * non-React modules (lib/auth-client) need to invalidate its cache at
 * sign-in / sign-out so per-user data never survives an identity change on
 * the same browser. This registry gives them a handle without prop-drilling.
 */

import type { QueryClient } from '@tanstack/react-query';

let registered: QueryClient | null = null;

/** Register the app's QueryClient (called once from <Providers/>). */
export function registerQueryClient(client: QueryClient): void {
  registered = client;
}

/**
 * Invalidate all per-user queries. Called on sign-in success and sign-out so
 * the next session starts with a fresh RQ fetch instead of serving the
 * previous user's cached permissions/roles as "fresh" (staleTime up to 30 min).
 * No-op when no client is registered yet (SSR / early module load).
 */
export function invalidateUserPermissionQueries(): void {
  void registered?.invalidateQueries({ queryKey: ['user'] });
}
