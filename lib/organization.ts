import { auth } from './auth';

/**
 * Organization plugin configuration boilerplate and helper functions.
 *
 * Exports utilities for:
 * - Getting the current organization from session
 * - Scoping Prisma queries to the current organization
 * - Checking organization-scoped permissions
 */

/**
 * Get the active organization for a given session/user.
 * In production, this would read from the user's session or cookie.
 */
export async function getCurrentOrganization(userId: string) {
  // Placeholder — implement when organization switching UI is built
  return null;
}

/**
 * Check if a user has a specific role in an organization.
 */
export function hasOrganizationRole(
  userRole: string,
  requiredRole: string
): boolean {
  const roleHierarchy = [
    'super_admin',
    'admin',
    'manager',
    'member',
  ] as const;

  const userIndex = roleHierarchy.indexOf(userRole as typeof roleHierarchy[number]);
  const requiredIndex = roleHierarchy.indexOf(requiredRole as typeof roleHierarchy[number]);

  return userIndex >= 0 && requiredIndex >= 0 && userIndex <= requiredIndex;
}

/**
 * Check if a user has a specific permission in an organization.
 */
export function hasPermission(
  userPermissions: string[],
  requiredPermission: string
): boolean {
  return userPermissions.includes(requiredPermission);
}
