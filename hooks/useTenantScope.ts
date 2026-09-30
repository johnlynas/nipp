/**
 * Dashboard scope hooks — shared by the admin (`/dashboard/admin`) and
 * tenant (`/dashboard/tenant`) shells.
 *
 * One binary drives the whole surface: super admins operate the platform
 * (any organization, full CRUD); everyone else is scoped to their own
 * organization in read-only mode. Unknown/loading resolves to read-only,
 * so edit affordances never flash before permissions resolve.
 */

import { useSession } from '@/lib/auth-client';
import { useIsSuperAdmin } from '@/hooks/usePermission';

interface ScopedUser {
  isSuperAdmin?: boolean;
}

/**
 * True (once resolved) when the current user can act across organizations.
 * `null` while the session/permissions are still loading.
 */
export function useIsPlatformAdmin(): boolean | null {
  const { data: session } = useSession();
  const fromPermissions = useIsSuperAdmin();
  const user = (session as { user?: ScopedUser } | null)?.user;

  // The better-auth session flag is authoritative when present.
  if (user?.isSuperAdmin !== undefined) return user.isSuperAdmin;

  // Otherwise fall back to the derived-permissions answer ('*' wildcard).
  return fromPermissions;
}

/**
 * The tenant workspace's view model: every page under `/dashboard/tenant`
 * renders for the user's own organization in read-only mode unless the
 * viewer is a super admin (platform admins may open tenant orgs there too).
 */
export function useTenantScope() {
  const isSuperAdmin = useIsPlatformAdmin();
  return {
    isSuperAdmin,
    /** true until super-admin status has positively resolved. */
    isReadOnly: isSuperAdmin !== true,
  };
}
