/**
 * Role name validation utilities.
 *
 * Prevents S4: Member.role is a free-text string by ensuring that any role name
 * assigned to a member corresponds to an existing Role in the organization.
 */

import prisma from '@/lib/db';

/**
 * Validate that a role name exists in the given organization.
 *
 * @param roleName - The role name to validate (e.g., "Property Manager")
 * @param orgId - The organization ID to scope the lookup
 * @returns true if the role exists, false otherwise
 */
export async function isValidRoleName(roleName: string, orgId: string): Promise<boolean> {
  if (!roleName || !orgId) return false;

  const role = await prisma.role.findFirst({
    where: { name: roleName, organizationId: orgId },
    select: { id: true },
  });

  return !!role;
}

/**
 * Get all valid role names for an organization.
 * Useful for populating dropdowns and validating bulk assignments.
 */
export async function getValidRoleNames(orgId: string): Promise<string[]> {
  const roles = await prisma.role.findMany({
    where: { organizationId: orgId },
    select: { name: true },
  });

  return roles.map((r) => r.name);
}

/**
 * Validate a role name and throw if invalid.
 * Use this in API routes for fail-fast validation.
 */
export async function assertValidRoleName(
  roleName: string,
  orgId: string
): Promise<void> {
  if (!roleName) {
    throw new Error('Role name is required');
  }

  if (!orgId) {
    throw new Error('Organization ID is required');
  }

  const exists = await isValidRoleName(roleName, orgId);
  if (!exists) {
    throw new Error(`Role "${roleName}" does not exist in this organization`);
  }
}
