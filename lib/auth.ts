import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { prisma } from '@/lib/db';
import { organization } from 'better-auth/plugins';

interface ExtendedUser {
  permissions: string[];
  isSuperAdmin: boolean;
}

interface ExtendedSession {
  user: ExtendedUser | null;
  activeOrganizationId: string | null;
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),

  // SECURITY (S2): Configure BetterAuth to trust our reverse proxy for real client IP.
  // BetterAuth walks the x-forwarded-for chain right-to-left, skipping trusted proxy IPs,
  // and uses the first untrusted address as the client IP. This fixes session security
  // (IP binding) and audit log forensic integrity when behind a load balancer.
  advanced: {
    ipAddress: {
      // Add your proxy/load-balancer CIDRs here. When set, BetterAuth strips trusted
      // hops from the right and uses the first untrusted address as the real client IP.
      // Without this, a single-value x-forwarded-for header is trusted (which is safe
      // only when no proxies are in use).
      // trustedProxies: ['10.0.0.0/8', '172.16.0.0/12'],
    },
    // SECURITY (S11): Force Secure cookie attribute + SameSite=Lax for all cookies.
    // useSecureCookies: true ensures the Secure flag is set even in dev (localhost).
    // defaultCookieAttributes.sameSite: 'Lax' is the CSRF-safe default — cookies are
    // sent on top-level GET navigations (e.g., following a link) but blocked on
    // cross-site POST/PUT/PATCH/DELETE requests.
    useSecureCookies: true,
    defaultCookieAttributes: {
      sameSite: 'lax',
    },
  },

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    disableSignUp: true, // Block public registration
  },

  plugins: [organization()],

  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      maxAge: 60 * 60, // 1 hour (prevents DB hits during short outages)
    },
  },

  // SECURITY (S5): Rate limit all auth endpoints to prevent brute-force attacks.
  // The customRules target the password sign-in endpoint specifically with a tight limit.
  rateLimit: {
    enabled: true, // Override default (production-only) to enable in all environments
    window: 15 * 60, // 15 minutes (in seconds)
    max: 10,         // 10 requests per window per IP
    customRules: {
      // Tighter limit for password sign-in to prevent brute-force
      '/api/auth/sign-in/email': {
        window: 15 * 60, // 15 minutes
        max: 5,          // 5 attempts per window
      },
    },
  },

  callbacks: {
    async session({ session, user }: { session: ExtendedSession; user: any }): Promise<ExtendedSession> {
      // Check if we're in Edge Runtime (middleware)
      // If so, skip permission resolution to avoid Prisma errors
      const isEdgeRuntime = typeof (globalThis as any).EdgeRuntime !== 'undefined';

      if (isEdgeRuntime) {
        // In Edge Runtime, return session without permissions
        // Permissions will be fetched separately via API
        return session;
      }

      // In Node.js runtime, resolve permissions
      try {
        const { resolvePermissions } = await import('@/lib/permissions/resolver');
        const { getPlatformOrgId } = await import('@/lib/authz');

        const orgId = session.activeOrganizationId;
        if (orgId) {
          const permissions = await resolvePermissions(user.id, orgId);
          const platformOrgId = await getPlatformOrgId();
          const isSuperAdmin = orgId === platformOrgId;

          return {
            ...session,
            user: {
              ...session.user,
              permissions,
              isSuperAdmin,
            },
          } as ExtendedSession;
        }
      } catch (error) {
        console.error('[Auth] Failed to resolve permissions:', error);
      }

      return session;
    },
  },
});
