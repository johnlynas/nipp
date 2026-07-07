/**
 * BetterAuth type augmentation.
 *
 * Extends the BetterAuth Session and User interfaces to include
 * our custom permissions and role fields.
 */

import type { BetterAuthOptions, DefaultSession } from 'better-auth';

declare module 'better-auth' {
  interface Session {
    /**
     * Map of organization ID -> resolved permission keys.
     * Populated by the session callback in lib/auth.ts.
     */
    permissions: Record<string, string[]>;

    /**
     * Whether the user is a Super Admin (member of the Platform Organization).
     */
    isSuperAdmin: boolean;
  }
}
