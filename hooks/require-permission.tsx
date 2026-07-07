/**
 * RequirePermission component.
 *
 * Conditionally renders child components based on user permissions.
 */

'use client';

import { useHasPermission, useAnyPermission } from './usePermission';

interface RequirePermissionProps {
  /**
   * A single permission key required to render children.
   * Mutually exclusive with `anyOf`.
   */
  permission?: string;

  /**
   * An array of permissions — user needs ANY of these to render children.
   * Mutually exclusive with `permission`.
   */
  anyOf?: string[];

  /**
   * Optional organization ID to scope the permission check.
   */
  orgId?: string;

  /**
   * Children to render if the user has the required permission(s).
   */
  children: React.ReactNode;

  /**
   * Fallback to render if the user does NOT have the required permission(s).
   * Can be false (render nothing), null, or a React node.
   */
  fallback?: React.ReactNode | false;
}

/**
 * Wrapper component that conditionally renders children based on permissions.
 *
 * @example
 * ```tsx
 * // Require a single permission
 * <RequirePermission permission="properties:create">
 *   <CreatePropertyButton />
 * </RequirePermission>
 *
 * // Require any of several permissions
 * <RequirePermission anyOf={['roles:view', 'members:invite']}>
 *   <AdminPanel />
 * </RequirePermission>
 *
 * // No fallback — renders nothing if permission denied
 * <RequirePermission permission="financials:export" fallback={false}>
 *   <ExportReport />
 * </RequirePermission>
 * ```
 */
export function RequirePermission({
  permission,
  anyOf,
  orgId,
  children,
  fallback = null,
}: RequirePermissionProps) {
  let hasAccess = false;

  if (permission) {
    hasAccess = useHasPermission(permission, orgId);
  } else if (anyOf && anyOf.length > 0) {
    hasAccess = useAnyPermission(anyOf, orgId);
  } else {
    // No permission specified — render children by default
    hasAccess = true;
  }

  if (hasAccess) {
    return <>{children}</>;
  }

  if (fallback === false) return null;
  return <>{fallback}</>;
}
