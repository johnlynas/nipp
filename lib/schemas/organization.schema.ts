import { z } from 'zod';

/**
 * Organization validation schemas.
 */

export const createOrganizationSchema = z.object({
  name: z.string().min(1, 'Organization name is required').max(255),
  slug: z.string().min(1, 'Slug is required').max(63).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase alphanumeric with hyphens'),
  // Zod v4: z.record requires both keyType and valueType
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const updateOrganizationSchema = z.object({
  name: z.string().min(1, 'Organization name is required').max(255).optional(),
  slug: z.string().min(1, 'Slug is required').max(63).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase alphanumeric with hyphens').optional(),
});

export const inviteMemberSchema = z.object({
  email: z.string().email('Invalid email address'),
  role: z.enum(['admin', 'manager', 'member']).default('member' as const),
});
