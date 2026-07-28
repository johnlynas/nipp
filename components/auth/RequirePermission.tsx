'use client';

import { ReactNode } from 'react';
import { useHasPermission, useAnyPermission, useAllPermissions, useIsSuperAdmin } from '@/hooks/usePermission';

type RequirePermissionProps = {
  permission: string | string[];
  mode?: 'any' | 'all';
  orgId?: string;
  fallback?: ReactNode;
  children: ReactNode;
};

/**
 * Conditionally renders children based on user permissions.
 * 
 * @example
 * // Single permission
 * <RequirePermission permission="properties:create">
 *   <CreateButton />
 * </RequirePermission>
 * 
 * @example
 * // Any of multiple permissions
 * <RequirePermission permission={["financial:report", "financial:export"]} mode="any">
 *   <FinancialActions />
 * </RequirePermission>
 * 
 * @example
 * // All of multiple permissions
 * <RequirePermission permission={["properties:create", "properties:delete"]} mode="all">
 *   <AdminPanel />
 * </RequirePermission>
 * 
 * @example
 * // With fallback
 * <RequirePermission permission="admin:settings" fallback={<AccessDenied />}">
 *   <SettingsPanel />
 * </RequirePermission>
 */
/**
 * NOTE: All hooks are called unconditionally at the top level to comply
 * with React's rules of hooks. Conditional logic is applied to results,
 * not to hook invocation.
 */
export function RequirePermission({
  permission,
  mode = 'all',
  orgId: _orgId,
  fallback = null,
  children,
}: RequirePermissionProps) {
  const isSuperAdmin = useIsSuperAdmin();

  // Always call hooks unconditionally (React rules of hooks)
  const hasPermission = useHasPermission(typeof permission === 'string' ? permission : '');
  const anyPermissionResult = useAnyPermission(Array.isArray(permission) ? permission : []);
  const allPermissionsResult = useAllPermissions(Array.isArray(permission) ? permission : []);

  // Super Admins bypass all permission checks
  if (isSuperAdmin) {
    return <>{children}</>;
  }

  let hasAccess = false;

  if (Array.isArray(permission)) {
    if (permission.length === 0) {
      hasAccess = true;
    } else if (mode === 'any') {
      hasAccess = anyPermissionResult;
    } else {
      hasAccess = allPermissionsResult;
    }
  } else {
    hasAccess = hasPermission;
  }

  if (!hasAccess) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}