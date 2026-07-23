import React from 'react';
import { useUserRoles } from '../api/usePermissions';

// Component: Role Guard (Role-based Access)
// Renders children ONLY if the user is assigned to ALL specified roles.
interface RoleGuardProps extends React.PropsWithChildren {
  role: string | string[]; // e.g., "super_admin" or ["admin", "manager"]
  onForbidden?: React.ReactNode;
}

export const RoleGuard = ({ role, children, onForbidden }: RoleGuardProps) => {
  // If the user passes multiple roles as an array, they must have ALL of them.
  const requiredRoles = Array.isArray(role) ? role : [role];
  
  const { data: userRoles, isLoading } = useUserRoles();

  // Wait for roles to load from cache
  if (isLoading) return null;
  
  const currentRoles = userRoles ?? []; // e.g., ['manager']

  // Check if the user possesses every single required role
  const passes = requiredRoles.every((r) => currentRoles.includes(r));

  if (!passes) return <>{onForbidden}</>;
  
  return <>{children}</>;
};
