/**
 * Backend authorization utilities.
 *
 * Provides functions to check user permissions and roles against the
 * resolved permission set. All functions operate on a permission array
 * (typically from the BetterAuth session object).
 */

import { prisma } from '@/lib/db';
import { resolvePermissions } from './permissions/resolver';

// ---------------------------------------------------------------------------
// Permission checking
// ---------------------------------------------------------------------------

/**
 * Check if a user has a specific permission in an organization.
 *
 * @param userId - The user's ID
 * @param orgId - The organization ID to check against
 * @param permission - The permission key to check (e.g., 'properties:view')
 * @returns true if the user has the permission, false otherwise
 */
export async function hasPermission(
  userId: string,
  orgId: string,
  permission: string
): Promise<boolean> {
  const permissions = await resolvePermissions(userId, orgId);
  return permissions.includes(permission);
}

/**
 * Check if a user has ANY of the specified permissions in an organization.
 *
 * @param userId - The user's ID
 * @param orgId - The organization ID to check against
 * @param permissions - Array of permission keys to check
 * @returns true if the user has at least one of the permissions
 */
export async function hasAnyPermission(
  userId: string,
  orgId: string,
  permissions: string[]
): Promise<boolean> {
  const userPermissions = await resolvePermissions(userId, orgId);
  return permissions.some((p) => userPermissions.includes(p));
}

/**
 * Check if a user has ALL of the specified permissions in an organization.
 *
 * @param userId - The user's ID
 * @param orgId - The organization ID to check against
 * @param permissions - Array of permission keys to check
 * @returns true if the user has all of the permissions
 */
export async function hasAllPermissions(
  userId: string,
  orgId: string,
  permissions: string[]
): Promise<boolean> {
  const userPermissions = await resolvePermissions(userId, orgId);
  return permissions.every((p) => userPermissions.includes(p));
}

// ---------------------------------------------------------------------------
// Super Admin checking
// ---------------------------------------------------------------------------

/**
 * Check if a user is a Super Admin (member of the Platform Organization).
 *
 * @param userId - The user's ID
 * @returns true if the user is a Super Admin
 */
export async function isSuperAdmin(userId: string): Promise<boolean> {
  const platformOrgId = await getPlatformOrgId();
  if (!platformOrgId) return false;

  const member = await prisma.member.findFirst({
    where: {
      userId,
      orgId: platformOrgId,
    },
  });

  return member !== null;
}

/**
 * Check if a user is a Super Admin OR has a specific permission.
 * Super Admins bypass all permission checks.
 *
 * @param userId - The user's ID
 * @param orgId - The organization ID to check against (ignored for Super Admins)
 * @param permission - The permission key to check
 * @returns true if the user is a Super Admin OR has the permission
 */
export async function hasPermissionOrIsSuperAdmin(
  userId: string,
  orgId: string,
  permission: string
): Promise<boolean> {
  const isSuper = await isSuperAdmin(userId);
  if (isSuper) return true;

  return hasPermission(userId, orgId, permission);
}

// ---------------------------------------------------------------------------
// Platform Organization helpers
// ---------------------------------------------------------------------------

/**
 * Get the Platform Organization ID from the database.
 * Returns null if not yet seeded.
 */
export async function getPlatformOrgId(): Promise<string | null> {
  const org = await prisma.organization.findFirst({
    where: { name: 'Platform' },
    select: { id: true },
  });
  return org?.id ?? null;
}

/**
 * Check if an organization ID is the Platform Organization.
 */
export async function isPlatformOrg(orgId: string): Promise<boolean> {
  const platformOrgId = await getPlatformOrgId();
  return platformOrgId === orgId;
}
