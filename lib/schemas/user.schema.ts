import { z } from 'zod';

/**
 * User validation schemas.
 */

export const createUserSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const updateUserSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255).optional(),
  email: z.string().email('Invalid email address').optional(),
});

// Zod v4: use a custom refinement instead of z.literal with errorMap
export const deleteUserSchema = z.object({
  confirm: z.boolean().refine(
    (val) => val === true,
    { message: 'Type "true" to confirm deletion' }
  ),
});
