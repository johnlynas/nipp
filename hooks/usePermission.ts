/**
 * Frontend authorization hooks.
 *
 * Provides React hooks to check user permissions from the BetterAuth session.
 */

'use client';

import { useEffect, useState } from 'react';
import { authClient } from '@/lib/auth-client';

interface SessionData {
  user: { id: string; name: string; email: string; image?: string | null };
  session: { token: string; expiresAt: Date };
  permissions?: Record<string, string[]>;
  isSuperAdmin?: boolean;
}

/**
 * Custom hook to fetch and cache the current session.
 */
function useSessionData(): SessionData | null {
  const [session, setSession] = useState<SessionData | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const result = await authClient.getSession({
        fetchOptions: {
          onError: () => { /* silently ignore */ },
        },
      });
      if (!cancelled && result.data) {
        setSession(result.data as unknown as SessionData);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return session;
}

// ---------------------------------------------------------------------------
// Permission checking hooks
// ---------------------------------------------------------------------------

/**
 * Check if the current user has a specific permission in an organization.
 */
export function useHasPermission(
  permission: string,
  orgId?: string
): boolean {
  const session = useSessionData();

  if (!session?.user) return false;
  if (session.isSuperAdmin) return true;

  if (orgId) {
    const orgPerms = session.permissions?.[orgId];
    return Array.isArray(orgPerms) && orgPerms.includes(permission);
  }

  const perms = session.permissions;
  if (!perms || typeof perms !== 'object') return false;
  return Object.values(perms).some(
    (orgPerms) => Array.isArray(orgPerms) && orgPerms.includes(permission)
  );
}

/**
 * Check if the current user has ANY of the specified permissions.
 */
export function useAnyPermission(
  permissions: string[],
  orgId?: string
): boolean {
  const session = useSessionData();

  if (!session?.user) return false;
  if (session.isSuperAdmin) return true;

  if (orgId) {
    const orgPerms = session.permissions?.[orgId];
    return Array.isArray(orgPerms) && permissions.some((p) => orgPerms.includes(p));
  }

  const perms = session.permissions;
  if (!perms || typeof perms !== 'object') return false;
  return Object.values(perms).some(
    (orgPerms) => Array.isArray(orgPerms) && permissions.some((p) => orgPerms.includes(p))
  );
}

/**
 * Check if the current user has ALL of the specified permissions.
 */
export function useAllPermissions(
  permissions: string[],
  orgId?: string
): boolean {
  const session = useSessionData();

  if (!session?.user) return false;
  if (session.isSuperAdmin) return true;

  if (orgId) {
    const orgPerms = session.permissions?.[orgId];
    return Array.isArray(orgPerms) && permissions.every((p) => orgPerms.includes(p));
  }

  const perms = session.permissions;
  if (!perms || typeof perms !== 'object') return false;
  return Object.values(perms).every(
    (orgPerms) => Array.isArray(orgPerms) && permissions.every((p) => orgPerms.includes(p))
  );
}

/**
 * Check if the current user is a Super Admin.
 */
export function useIsSuperAdmin(): boolean {
  const session = useSessionData();
  return !!session?.isSuperAdmin;
}

/**
 * Get the current user's session data with permissions.
 */
export function useAuthSession() {
  return useSessionData();
}

/**
 * Get the current user's role in a specific organization.
 */
export function useOrgRole(orgId: string): string | null {
  const session = useSessionData();

  if (session?.isSuperAdmin) return 'super_admin';
  return null;
}
