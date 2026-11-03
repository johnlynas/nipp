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

interface SessionUser {
  permissions?: string[];
  isSuperAdmin?: boolean;
}

/** Shape of the better-auth session returned by useSession(). */
interface AuthSession {
  user: SessionUser;
}

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
  const user = (session as AuthSession | null)?.user;
  if (user?.permissions) {
    return user.permissions.includes(permission);
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
  const user = (session as AuthSession | null)?.user;
  if (user?.permissions) {
    return permissions.some((p) => user.permissions!.includes(p));
  }

  // Slow path: wait for React Query cache to load
  if (isLoading) return false;

  const available = userPermissions ?? [];
  return permissions.some((p) => available.includes(p));
}

/**
 * Check if the user is a Super Admin.
 *
 * Returns true, false, or null (unknown/loading). RequireSuperAdmin renders
 * children optimistically while this is null/undefined and AccessDenied only
 * on an explicit false — so false must be CONFIRMED, never assumed:
 *
 *  - session flag true  → true immediately (fast path)
 *  - session flag false OR the extended fields are absent entirely (bare
 *    /get-session payload from a cookie-cache hit / Edge-skipped callback —
 *    the "Access Denied after ~10s" window) → defer to a LIVE permissions
 *    query: still loading or transient failure → null (optimistic), loaded
 *    ['*'] → true, any other loaded list → false.
 */
export function useIsSuperAdmin(): boolean | null {
  const { data: session } = useSession();
  const { data: permissions, isLoading, isError } = usePermissions();

  const user = (session as AuthSession | null)?.user;
  if (user?.isSuperAdmin === true) {
    return true;
  }

  // Everything else verifies against the live permissions endpoint result.
  if (isLoading || isError) return null; // stay optimistic until proven otherwise

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
  const user = (session as AuthSession | null)?.user;
  if (user?.isSuperAdmin) {
    return true;
  }

  // Fast path: session already has permissions resolved
  if (user?.permissions) {
    return permissions.every((p) => user.permissions!.includes(p));
  }

  // Slow path: wait for React Query cache to load
  if (isLoading) return false;

  const available = userPermissions ?? [];
  return permissions.every((p) => available.includes(p));
}