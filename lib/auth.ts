import { betterAuth } from 'better-auth';
import { prisma } from './db';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { organization } from 'better-auth/plugins';
import { admin } from 'better-auth/plugins';
import { resolvePermissions, invalidatePermissionCache } from './permissions/resolver';
import * as authz from './authz';

/**
 * BetterAuth configuration.
 *
 * Integrates:
 * - Prisma adapter for database persistence
 * - Email/Password plugin (built-in, default)
 * - Google OIDC plugin (built-in social provider)
 * - Organization plugin for multi-tenancy
 * - Admin plugin for user/session management
 * - Session callback for permission augmentation
 */
export const auth = betterAuth({
  // Database
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),

  // Email/Password (built-in)
  emailAndPassword: {
    enabled: true,
    // Argon2id is the default hashing algorithm in better-auth
    requireEmailVerification: false, // Deferred to future proposal
  },

  // Social providers — Google only in this phase
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },

  // Session configuration — same-origin cookies
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes
    },
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
    // -----------------------------------------------------------------------
    // Session callback — augment with resolved permissions (4.1-4.4)
    // -----------------------------------------------------------------------
    callback: async (session: { user: { id: string }; [key: string]: unknown }) => {
      try {
        const userId = session.user.id;

        // Fetch all organizations the user belongs to
        const memberships = await prisma.member.findMany({
          where: { userId },
          select: { orgId: true, role: true },
        });

        // Build a map of orgId -> permissions
        const permissionsByOrg: Record<string, string[]> = {};

        for (const membership of memberships) {
          try {
            permissionsByOrg[membership.orgId] = await resolvePermissions(
              userId,
              membership.orgId
            );
          } catch {
            // CRITICAL (4.3): Permission resolution failures return empty array,
            // NOT a session error — this avoids invalidating valid sessions.
            permissionsByOrg[membership.orgId] = [];
          }
        }

        // Check if user is a Super Admin
        let superAdmin = false;
        try {
          superAdmin = await authz.isSuperAdmin(userId);
        } catch {
          // Silently ignore — super admin check failure should not break login
        }

        // Augment session with permissions and role info (4.4)
        return {
          ...session,
          permissions: permissionsByOrg,
          isSuperAdmin: superAdmin,
        };
      } catch (err) {
        // CRITICAL (4.3): Any error in the session callback must NOT invalidate
        // the session. Log and return original session unchanged.
        // eslint-disable-next-line no-console
        console.error('[Session callback error]', err);
        return session;
      }
    },
  },

  // Organization plugin for multi-tenancy
  plugins: [
    organization(),
    admin({
      defaultRole: 'member',
      // Note: Super Admin checks are handled by our custom authz.ts (isSuperAdmin),
      // not the BetterAuth admin plugin. Only 'admin' is registered here because
      // BetterAuth requires all adminRoles to be defined in the 'roles' config,
      // which uses a complex Role type with authorize functions.
      adminRoles: ['admin'],
    }),
  ],

  // Rate limiting on auth endpoints (built-in)
  rateLimit: {
    enabled: true,
    window: 60, // seconds
    max: 100, // requests per window
  },
});
