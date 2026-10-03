import { betterAuth } from 'better-auth/minimal';
import { prismaAdapter } from 'better-auth/adapters/prisma';
// Use relative import to bypass tenant isolation rule (BetterAuth needs raw Prisma client)
import { prisma } from './db';
import { organization } from 'better-auth/plugins';
import { env } from './env';
import { createAuthMiddleware, APIError } from 'better-auth/api';
import { logger } from './logger';

interface ExtendedUser {
  permissions: string[];
  isSuperAdmin: boolean;
}

interface ExtendedSession {
  user: ExtendedUser | null;
  activeOrganizationId: string | null;
}

/**
 * Enforce the ban flag for the user with the given email.
 *
 * Single source of truth for ban behaviour, shared by BOTH sign-in doors so
 * no method can bypass it (design doc §5.1):
 *  - email sign-in: called from the `hooks.before` route middleware (pre-session,
 *    keeps today's fast 401 on the login form)
 *  - Google OIDC sign-in: called from `databaseHooks.session.create.before`,
 *    the single point where every successful sign-in funnels with `session.userId`
 *    known. A banned user cannot be banned before their first session exists, so
 *    there is no bypass at creation time.
 *
 * Expired bans are lifted in place (flag cleared, login proceeds). An active ban
 * throws APIError('UNAUTHORIZED') with the message the login page's banned banner
 * already recognises.
 */
export async function enforceBanStatus(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });

  if (user?.banned) {
    const now = new Date();
    // If ban has expired, allow login (ban is lifted)
    if (user.banExpires && user.banExpires < now) {
      await prisma.user.update({
        where: { id: user.id },
        data: { banned: false, banReason: null, banExpires: null },
      });
    } else {
      const reason = user.banReason || 'Your account has been banned.';
      logger.warn(
        { userId: user.id, email },
        `Banned user login attempt: ${reason}`,
      );
      throw new APIError('UNAUTHORIZED', {
        message: `Access denied. ${reason}`,
      });
    }
  }
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
    // useSecureCookies: true in production ensures the Secure flag is set (required for HTTPS).
    // In dev (localhost) we skip it so cookies work over plain HTTP.
    // defaultCookieAttributes.sameSite: 'Lax' is the CSRF-safe default — cookies are
    // sent on top-level GET navigations (e.g., following a link) but blocked on
    // cross-site POST/PUT/PATCH/DELETE requests.
    useSecureCookies: env.NODE_ENV !== 'development',
    defaultCookieAttributes: {
      sameSite: 'lax',
    },
  },

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    disableSignUp: true, // Block public registration
  },

  // Google OIDC sign-in. Default scopes (openid email profile); no offline access.
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
  },

  plugins: [
    organization({
      // Enable Teams mode — sub-organizational groupings with role inheritance
      teams: {
        enabled: true,
        // Allow organizations to have multiple teams (default: no limit)
        maximumTeams: undefined,
        // Allow removing all teams from an organization
        allowRemovingAllTeams: true,
      },

      // -----------------------------------------------------------------
      // Team-specific hooks (scaffolded as no-op stubs for future extension)
      // -----------------------------------------------------------------

      // Team creation hooks
      beforeCreateTeam: async ({ data, _session, _organization, _context }: Record<string, unknown>) => {
        // TODO: Implement custom team creation logic (e.g., audit logging)
        return data;
      },
      afterCreateTeam: async ({ _team, _session, _organization, _context }: Record<string, unknown>) => {
        // TODO: Implement post-creation logic (e.g., create default resources)
      },

      // Team update hooks
      beforeUpdateTeam: async ({ data, _session, _organization, _context }: Record<string, unknown>) => {
        // TODO: Implement custom team update logic
        return data;
      },
      afterUpdateTeam: async ({ _team, _session, _organization, _context }: Record<string, unknown>) => {
        // TODO: Implement post-update logic
      },

      // Team deletion hooks
      beforeDeleteTeam: async ({ _team, _session, _organization, _context }: Record<string, unknown>) => {
        // TODO: Implement pre-deletion cleanup logic
      },
      afterDeleteTeam: async ({ _team, _session, _organization, _context }: Record<string, unknown>) => {
        // TODO: Implement post-deletion cleanup logic
      },

      // Team member hooks
      beforeAddTeamMember: async ({ _team, _user, _session, _organization, _context }: Record<string, unknown>) => {
        // TODO: Implement pre-add validation (e.g., check org membership)
      },
      afterAddTeamMember: async ({ _team, _user, _session, _organization, _context }: Record<string, unknown>) => {
        // TODO: Implement post-add logic (e.g., assign team roles, notify)
      },
      beforeRemoveTeamMember: async ({ _team, _user, _session, _organization, _context }: Record<string, unknown>) => {
        // TODO: Implement pre-remove validation (e.g., check last member)
      },
      afterRemoveTeamMember: async ({ _team, _user, _session, _organization, _context }: Record<string, unknown>) => {
        // TODO: Implement post-remove cleanup (e.g., revoke team roles)
      },
    }),
  ],

  session: {
    expiresIn: 60 * 60, // 1 hour absolute maximum (tight backstop for inactivity policy)
    updateAge: 60 * 15, // 15-minute renewal threshold for active sessions
    cookieCache: {
      enabled: true,
      maxAge: 60 * 60, // 1 hour (prevents DB hits during short outages)
    },
  },

  // SECURITY (S5): Rate limit all auth endpoints to prevent brute-force attacks.
  // The customRules target the password sign-in endpoint specifically with a tight limit.
  rateLimit: {
    enabled: env.NODE_ENV !== 'test', // Disable in test environment to avoid blocking e2e tests
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

  // ---------------------------------------------------------------------------
  // Auto-assign active organization on session creation.
  // Since each user belongs to exactly one org (1:1), we look up their
  // Member record and set activeOrganizationId on the User model (the field
  // lives there, not on Session). This way /api/auth/me returns it and
  // calendar/event APIs work without a manual "select org" step.
  // ---------------------------------------------------------------------------
  databaseHooks: {
    session: {
      create: {
        // Ban enforcement for EVERY sign-in method (design doc §5.1). Session
        // creation is the single point where every successful sign-in funnels
        // with userId known — email, Google OIDC (returning user and any future
        // re-login), and methods added later. Throwing APIError here makes
        // BetterAuth reply 401 with the exact 'Access denied. …' message the
        // login page's banned banner already recognises; no session is issued.
        before: async (session) => {
          const user = await prisma.user.findUnique({
            where: { id: session.userId },
            select: { email: true },
          });
          if (!user) return; // BetterAuth guarantees the row exists; be defensive
          await enforceBanStatus(user.email);
        },
        after: async (session) => {
          logger.info(
            { userId: session.userId, sessionId: session.id },
            '[Auth] Session created — checking for activeOrganizationId',
          );

          // Only set the org once — skip if it's already assigned
          const current = await prisma.user.findUnique({
            where: { id: session.userId },
            select: { activeOrganizationId: true },
          });

          if (current?.activeOrganizationId) {
            logger.info(
              { userId: session.userId, activeOrgId: current.activeOrganizationId },
              '[Auth] User already has activeOrganizationId — skipping',
            );
            return;
          }

          logger.info(
            { userId: session.userId },
            '[Auth] User has no activeOrganizationId — looking up Member record',
          );

          const member = await prisma.member.findFirst({
            where: { userId: session.userId },
            select: { orgId: true },
          });

          if (member) {
            logger.info(
              { userId: session.userId, orgId: member.orgId },
              '[Auth] Found Member record — setting activeOrganizationId on User',
            );
            await prisma.user.update({
              where: { id: session.userId },
              data: { activeOrganizationId: member.orgId },
            });
          } else {
            logger.warn(
              { userId: session.userId },
              '[Auth] No Member record found for user — activeOrganizationId NOT set',
            );
          }
        },
      },
    },
  },

  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // Check banned status during email sign-in (keeps a fast 401 on the login
      // form; social sign-in is enforced at session creation — see below).
      if (ctx.path === '/sign-in/email' && ctx.body?.email) {
        await enforceBanStatus(ctx.body.email);
      }
    }),
  },

  callbacks: {
    async session({ session, user }: { session: ExtendedSession; user: { id: string } }): Promise<ExtendedSession | null> {
      // Check if we're in Edge Runtime (middleware)
      // If so, skip permission resolution to avoid Prisma errors
      const isEdgeRuntime = typeof (globalThis as { EdgeRuntime?: string }).EdgeRuntime !== 'undefined';

      if (isEdgeRuntime) {
        // In Edge Runtime, return session without permissions
        // Permissions will be fetched separately via API
        return session;
      }

      // In Node.js runtime, resolve permissions and check ban status
      try {
        // Check if user is banned — invalidate session if so
        const currentUser = await prisma.user.findUnique({ where: { id: user.id } });
        if (currentUser?.banned) {
          const now = new Date();
          // If ban has expired, clear the flag and allow session
          if (currentUser.banExpires && currentUser.banExpires < now) {
            await prisma.user.update({
              where: { id: user.id },
              data: { banned: false, banReason: null, banExpires: null },
            });
          } else {
            logger.warn(
              { userId: user.id, banReason: currentUser.banReason },
              'Session invalidated for banned user',
            );
            return null;
          }
        }

        const { resolvePermissions } = await import('@/lib/permissions/resolver');
        const { getPlatformOrgId, isSuperAdmin: checkIsSuperAdmin } = await import('@/lib/authz');

        const platformOrgId = await getPlatformOrgId();
        let isSuperAdmin = false;
        let permissions: string[] = [];

        // Prefer session's activeOrganizationId (from test mocks or Node.js runtime),
        // fall back to DB lookup for Edge Runtime where the callback is skipped.
        const sessionOrgId = (session as { activeOrganizationId?: string | null }).activeOrganizationId;
        const effectiveOrgId = sessionOrgId ?? currentUser?.activeOrganizationId ?? null;

        if (platformOrgId) {
          // Check if user is a super admin (member of platform org)
          isSuperAdmin = await checkIsSuperAdmin(user.id, platformOrgId);

          if (isSuperAdmin) {
            // Super admins get wildcard permission
            permissions = ['*'];
          } else if (effectiveOrgId) {
            // Non-super admins get org-specific permissions
            permissions = await resolvePermissions(user.id, effectiveOrgId);
          }
        }

        return {
          ...session,
          activeOrganizationId: effectiveOrgId,
          user: {
            ...session.user,
            permissions,
            isSuperAdmin,
          },
        } as ExtendedSession;
      } catch (error) {
        console.error('[Auth] Failed to resolve permissions:', error);
      }

      return session;
    },
  },
});
