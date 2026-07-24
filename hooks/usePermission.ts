/**
 * Client-side permission hooks — migrated from raw fetch to React Query.
 *
 * PERFORMANCE (P2): Previously these hooks used useEffect + raw fetch with no caching,
 * causing unbounded network requests and duplicate calls. Now they use the existing
 * usePermissions hook from features/permissions/api/usePermissions.ts which has:
 *   - 30-minute staleTime (Redis-cached on server)
 *   - 1-hour gcTime (deduplication across components)
 *   - Proper loading/error states via React Query
 *
 * This eliminates the flash of incorrect content (FOIC) while removing redundant API calls.
 */

import { useSession } from '@/lib/auth-client';
import { usePermissions } from '@/features/permissions/api/usePermissions';

// ---------------------------------------------------------------------------
// Internal: check permissions against session data or React Query cache.
// ---------------------------------------------------------------------------

/**
 * Check if the user has a specific permission.
 * Returns true/false immediately from session data, or null while loading from cache.
 */
export function usePermission(permission: string): boolean {
  const { data: session } = useSession();
  const { data: permissions, isLoading } = usePermissions();

  // Fast path: session already has permissions resolved
  if ((session?.user as any)?.permissions) {
    return (session.user as any).permissions.includes(permission);
  }

  // Slow path: wait for React Query cache to load
  if (isLoading) return false;

  const available = permissions ?? [];
  return available.includes(permission);
}

/**
 * Check if the user has ANY of the given permissions.
 */
export function useAnyPermission(permissions: string[]): boolean {
  const { data: session } = useSession();
  const { data: userPermissions, isLoading } = usePermissions();

  // Fast path: session already has permissions resolved
  if ((session?.user as any)?.permissions) {
    return permissions.some((p) => (session.user as any).permissions.includes(p));
  }

  // Slow path: wait for React Query cache to load
  if (isLoading) return false;

  const available = userPermissions ?? [];
  return permissions.some((p) => available.includes(p));
}

/**
 * Check if the user is a Super Admin.
 */
export function useIsSuperAdmin(): boolean | null {
  const { data: session } = useSession();
  const { data: permissions, isLoading } = usePermissions();

  // Fast path: session already has isSuperAdmin flag
  if ((session?.user as any)?.isSuperAdmin !== undefined) {
    return (session.user as any).isSuperAdmin;
  }

  // Slow path: wait for React Query cache to load
  if (isLoading) return null;

  // Super Admins have the wildcard permission '*' or can be inferred from permissions
  const available = permissions ?? [];
  return available.includes('*');
}

/**
 * Alias for usePermission — checks if user has a specific permission.
 */
export function useHasPermission(permission: string): boolean {
  return usePermission(permission);
}

/**
 * Checks if user has ALL of the given permissions.
 */
export function useAllPermissions(permissions: string[]): boolean {
  const { data: session } = useSession();
  const { data: userPermissions, isLoading } = usePermissions();

  // Fast path: Super Admins have all permissions
  if ((session?.user as any)?.isSuperAdmin) {
    return true;
  }

  // Fast path: session already has permissions resolved
  if ((session?.user as any)?.permissions) {
    return permissions.every((p) => (session.user as any).permissions.includes(p));
  }

  // Slow path: wait for React Query cache to load
  if (isLoading) return false;

  const available = userPermissions ?? [];
  return permissions.every((p) => available.includes(p));
}
