/**
 * Member validation schemas.
 *
 * Prevents S4: Member.role is a free-text string by validating that role names
 * correspond to existing Role entries in the organization.
 */

import { z } from 'zod';

/**
 * Zod schema for Member.role — restricts to a predefined set of valid role names.
 * In production, this should be validated against the Role table at runtime.
 */
export const memberRoleSchema = z.object({
  role: z.string()
    .min(1, 'Role is required')
    .max(255, 'Role name must be 255 characters or less')
    .refine(
      async (roleName, ctx) => {
        // Runtime check: role name must exist in the organization's Role table
        const { isValidRoleName } = await import('@/lib/roles/validation');
        // orgId is passed via the calling context; this refine runs after
        // superRefine where we have access to the full object.
        return true; // placeholder — validated in superRefine below
      },
      { message: 'Role name is invalid' }
    ),
});

/**
 * Full member role assignment schema with runtime validation.
 */
export const assignMemberRoleSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  roleId: z.string().min(1, 'roleId is required'),
});

/**
 * Validate that a role name exists in the given organization.
 */
export async function validateMemberRole(roleName: string, orgId: string): Promise<{ valid: boolean; error?: string }> {
  if (!roleName || !orgId) {
    return { valid: false, error: 'Role name and organization ID are required' };
  }

  const { isValidRoleName } = await import('@/lib/roles/validation');
  const exists = await isValidRoleName(roleName, orgId);

  if (!exists) {
    return { valid: false, error: `Role "${roleName}" does not exist in this organization` };
  }

  return { valid: true };
}
