import { betterAuth } from 'better-auth';
import { prisma } from './db';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { organization } from 'better-auth/plugins';
import { admin } from 'better-auth/plugins';

/**
 * BetterAuth configuration.
 *
 * Integrates:
 * - Prisma adapter for database persistence
 * - Email/Password plugin (built-in, default)
 * - Google OIDC plugin (built-in social provider)
 * - Organization plugin for multi-tenancy
 * - Admin plugin for user/session management
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
  },

  // Organization plugin for multi-tenancy
  plugins: [
    organization(),
    admin({
      defaultRole: 'member',
      adminRoles: ['super_admin'],
    }),
  ],

  // Rate limiting on auth endpoints (built-in)
  rateLimit: {
    enabled: true,
    window: 60, // seconds
    max: 100, // requests per window
  },
});
