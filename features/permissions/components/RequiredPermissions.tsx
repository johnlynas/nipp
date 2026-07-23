import React from 'react';
import { useHasPermission } from '../api/usePermissions';

// Component: Required Permissions (AND Logic)
// Renders children ONLY if the user has ALL specified permissions.
interface RequiredPermissionsProps extends React.PropsWithChildren {
  permission: string | string[];
  onForbidden?: React.ReactNode; // Optional fallback UI to show instead of nothing
}

export const RequiredPermissions = ({ 
  permission, 
  children, 
  onForbidden = null 
}: RequiredPermissionsProps) => {
  const perms = Array.isArray(permission) ? permission : [permission];

  // Hook returns `undefined` while loading cache, `true`, or `false`
  const hasAccess = useHasPermission(perms);

  // While fetching, we show nothing to prevent Flash-of-Unauthorized-Content (FOUC)
  if (hasAccess === undefined) return null;

  // If the user doesn't have access, show custom forbidden content or nothing
  if (!hasAccess) return <>{onForbidden}</>;

  // Everything is good, show the UI
  return <>{children}</>;
};
