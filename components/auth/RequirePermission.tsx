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
 * <RequirePermission permission="admin:settings" fallback={<AccessDenied />}>
 *   <SettingsPanel />
 * </RequirePermission>
 */
export function RequirePermission({
  permission,
  mode = 'all',
  orgId,
  fallback = null,
  children,
}: RequirePermissionProps) {
  const isSuperAdmin = useIsSuperAdmin();
  
  // Super Admins bypass all permission checks
  if (isSuperAdmin) {
    return <>{children}</>;
  }

  let hasAccess = false;

  if (Array.isArray(permission)) {
    if (permission.length === 0) {
      hasAccess = true;
    } else if (mode === 'any') {
      hasAccess = useAnyPermission(permission, orgId);
    } else {
      hasAccess = useAllPermissions(permission, orgId);
    }
  } else {
    hasAccess = useHasPermission(permission, orgId);
  }

  if (!hasAccess) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}