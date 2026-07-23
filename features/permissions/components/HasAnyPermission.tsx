import React from 'react';
import { useHasAnyPermission } from '../api/usePermissions';

// Component: Has Any Permission (OR Logic)
// Renders children if the user has AT LEAST ONE of the specified permissions.
interface HasAnyPermissionProps extends React.PropsWithChildren {
  permission: string | string[];
  onForbidden?: React.ReactNode; // Optional fallback UI
}

export const HasAnyPermission = ({ 
  permission, 
  children, 
  onForbidden = null 
}: HasAnyPermissionProps) => {
  const perms = Array.isArray(permission) ? permission : [permission];

  // Hook returns `undefined` while loading cache, `true`, or `false`
  const hasAccess = useHasAnyPermission(perms);

  // While fetching, we hold the screen to prevent Flash-of-Unauthorized-Content (FOUC)
  if (hasAccess === undefined) return null;

  if (!hasAccess) return <>{onForbidden}</>;
  
  return <>{children}</>;
};
