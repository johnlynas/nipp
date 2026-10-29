import { betterAuth } from 'better-auth/minimal';
import { prismaAdapter } from 'better-auth/adapters/prisma';
// Use relative import to bypass tenant isolation rule (BetterAuth needs raw Prisma client)
import { prisma } from './db';
import { withPlatformContextForDB } from './rls-transaction';
import { organization, bearer } from 'better-auth/plugins';
import { env } from './env';
import tenantDb from '@/lib/tenant-db';
import { createAuthMiddleware, APIError } from 'better-auth/api';
import { logger } from './logger';
import { issueInviteLink } from './oidc-magic-link';
import { issueResetEmail, PASSWORD_RESET_TOKEN_TTL_SECS } from './forgot-password';

interface ExtendedUser {
  permissions: string[];
  isSuperAdmin: boolean;
}

interface ExtendedSession {
  user: ExtendedUser | null;
  activeOrganizationId: string | null;
}

// ---------------------------------------------------------------------------
// Portal origin for invitation emails (PUBLIC ACCESS fix, Phase H class)
// ---------------------------------------------------------------------------
// The magic-link email must use the origin the USER'S BROWSER is actually
// reaching on — http://<lan-ip>:3000 today, the public HTTPS domain in a cloud
// deploy. Pinned FRONTEND_URL produced dead links (localhost:3000 for a visitor
// on another machine), the same failure class as Phase A/B's better-auth base.
// The origin is derived from the incoming request at session time; outside a
// request context (admin-invite routes, cron) it falls back to FRONTEND_URL.
let lastRequest: Request | null = null;

/** Origin of the request that created the current session (if any). */
export function getLastRequestOrigin(): string | null {
  if (!lastRequest) return null;
  try {
    return new URL(lastRequest.url).origin;
  } catch {
    return null;
  }
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
  const op = async () => {
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
  };

  // RLS: the User table is exempt (global auth model), but run under the
  // platform context anyway so this single helper's DB access behaves
  // identically on owner and non-owner roles (mirrors lib/cache/warm.ts).
  const platformOrgId = env.PLATFORM_ORGANIZATION_ID;
  if (!platformOrgId) return op(); // test/deploy without a platform org — raw client pass-through

  return withPlatformContextForDB(platformOrgId, op);
}

/**
 * Enforce the pre-registration gate for Google OIDC sign-in (design §4.3 +
 * product decision: invite-only access).
 *
 * Primary door: the google provider is configured with `disableImplicitSignUp`
 * (lib/auth.ts socialProviders), so the OAuth callback REFUSES any identity
 * with no pre-existing User row — zero rows written, no email, before a session
 * could even be attempted. This gate is the last line of defence for the
 * sessions that DO reach creation: every such user must (a) have completed
 * magic-link verification (`oidcVerified === true`) and (b) belong to at least
 * one organization (`Member` row). Rejections throw APIError('UNAUTHORIZED') —
 * BetterAuth surfaces them as 401 on the OAuth callback with no session issued.
 *
 * Unverified invited users get a fresh magic link on every attempt (each issue
 * is a new token; old ones die on consume/expiry), so a missed email self-heals
 * by retrying the Google sign-in. Stray auto-registered rows (forged requestSignUp,
 * or legacy rows predating disableImplicitSignUp) are recognised by their shape —
 * no org membership AND no credential account: every admin invite has a Member
 * row, and an auto-registered identity is google-only. They are refused WITHOUT
 * an invitation email and the user row is removed best-effort (Accounts cascade).
 *
 * INVARIANT — local email/password login: the gate returns immediately for any
 * user WITHOUT a Google account, so the `/sign-in/email` path is byte-for-byte
 * unchanged; only the shared ban check (above) runs for them, exactly as before.
 */

/**
 * RLS-critical: the app role is nipp_app (non-owner), so Postgres applies the
 * rls_member_isolated policy to every Member read. User/Account are exempt, so
 * the identity lookup works through raw prisma — but a GUC-less membership
 * check returns ZERO rows even for provisioned users (verified live: Ruth's
 * Platform-org membership was invisible to this gate), which mis-reports
 * "not provisioned" and locks out valid members. The authoritative membership
 * query therefore runs under the sanctioned platform RLS context via
 * withPlatformRead — same pattern as lib/authz.ts's verifySuperAdmin /
 * lib/cache/warm.ts. Integration tests never caught this: they connect as
 * postgres (owner, RLS bypassed).
 */
function withPlatformRead<T>(op: () => Promise<T>): Promise<T> {
  const platformOrgId = env.PLATFORM_ORGANIZATION_ID;
  // Passes through raw when unset (unit-test mocks / non-platform dev) — the
  // owner/test connection sees rows anyway under that condition.
  return platformOrgId ? withPlatformContextForDB(platformOrgId, op) : op();
}

export async function enforceOidcProvisioning(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      oidcVerified: true,
      accounts: { select: { providerId: true } },
    },
  });
  if (!user) return; // defensive; BetterAuth guarantees the row exists

  const hasGoogle = user.accounts.some((a) => a.providerId === 'google');
  if (!hasGoogle) return; // email/password door — this gate is a no-op here

  // Authoritative membership count for EVERY branch (stray / unverified-invite /
  // verified-no-org) — Member is RLS-gated, so this MUST run under the platform
  // context (see withPlatformRead above). tenantDb resolves model ops to the
  // pinned connection where the GUCs are visible. Mail sends deliberately stay
  // OUTSIDE the pinned interactive transaction.
  const memberships = await withPlatformRead(async () => {
    const u = await tenantDb.user.findUnique({
      where: { id: userId },
      select: { members: { select: { orgId: true } } },
    });
    return u?.members ?? [];
  });

  // STRAY auto-registered identity (disableImplicitSignUp bypassed — e.g. a
  // client-forged requestSignUp:true — or legacy rows created before the flag
  // shipped, like today's johnlynasdev@gmail.com). Their shape is unambiguous:
  // no org membership AND no credential account AND not yet verified — every
  // VALID user has an organization + team (a team can carry 1:M roles for
  // permission refinement), and an admin-created user always gets one at
  // creation (UserService.create rejects passwordless invites without an org).
  // A user who is verified but still awaiting org assignment is NOT a stray:
  // it falls through to the "not provisioned" branch below (no delete, no
  // re-invite spam — their membership is being set up by the admin). Refuse
  // WITHOUT an invitation email, then remove the user row best-effort
  // (Accounts/Sessions cascade per schema) and drop any pending invite tokens
  // the earlier broken flow left behind. MUST NOT throw back to better-auth on
  // cleanup failure — a failed delete must not 500 the callback for a user who
  // was already refused; the rows stay quarantined and an admin can remove them.
  const hasCredential = user.accounts.some((a) => a.providerId === 'credential');
  if (memberships.length === 0 && !hasCredential && !user.oidcVerified) {
    logger.warn(
      { userId: user.id, email: user.email },
      '[Auth] Google sign-in blocked: uninvited identity with auto-registered rows — rejecting, no invitation emailed, rows removed',
    );
    void prisma.user
      .delete({ where: { id: user.id } })
      .catch((err) => {
        logger.error({ err, userId: user.id }, '[Auth] Failed to remove stray auto-registered identity (rows quarantined)');
      });
    void prisma.verification
      .deleteMany({
        where: { value: { contains: `"email":"${user.email.toLowerCase()}"` } },
      })
      .catch((err) => {
        logger.error({ err, userId: user.id }, '[Auth] Failed to remove stale invite tokens for stray identity');
      });
    throw new APIError('UNAUTHORIZED', {
      message:
        'Access denied. This account has not been invited to the portal yet. Contact your portal administrator.',
    });
  }

  if (user.oidcVerified === false) {
    logger.warn(
      { userId: user.id, email: user.email },
      '[Auth] Google sign-in blocked: magic-link verification pending — invitation link issued',
    );
    // issueInviteLink logs and swallows SMTP failures by contract (T2), so this
    // cannot take the auth pipeline down; the token lands in Verification when
    // the insert succeeds.
    await issueInviteLink(user, { portalOrigin: getLastRequestOrigin() });
    throw new APIError('UNAUTHORIZED', {
      message:
        'Access denied. We need to confirm your email first — check your inbox for a verification link, then try signing in with Google again.',
    });
  }

  if (memberships.length === 0) {
    logger.warn(
      { userId: user.id, email: user.email },
      '[Auth] Google sign-in blocked: verified but no organization membership (not provisioned)',
    );
    throw new APIError('UNAUTHORIZED', {
      message:
        'Access denied. This account has not been provisioned by an administrator yet. Contact your portal administrator.',
    });
  }
}


export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),

  // PUBLIC ACCESS (Phase B): per-request base URL, fully env-driven — this file
  // hardcodes zero host values. The Host is taken from each incoming request
  // (Host header; x-forwarded-host when TRUSTED_PROXY_HEADERS is on), validated
  // against BETTER_AUTH_ALLOWED_HOSTS, and used as base + trusted origin, so
  // localhost, LAN IP, tunnel hostname, and the production domain all work with
  // no code change. (A static BETTER_AUTH_URL froze trusted origins to one host
  // and caused remote INVALID_ORIGIN — see public-internet-bearer-access plan.)
  baseURL: {
    allowedHosts: env.BETTER_AUTH_ALLOWED_HOSTS.split(',').map((s) => s.trim()).filter(Boolean),
    protocol: env.BETTER_AUTH_BASE_PROTOCOL,
    fallback: env.FRONTEND_URL,
  },

  // SECURITY (S2): Configure BetterAuth to trust our reverse proxy for real client IP.
  // BetterAuth walks the x-forwarded-for chain right-to-left, skipping trusted proxy IPs,
  // and uses the first untrusted address as the client IP. This fixes session security
  // (IP binding) and audit log forensic integrity when behind a load balancer.
  advanced: {
    // PUBLIC ACCESS (Phase B): trust x-forwarded-host / x-forwarded-proto for
    // dynamic base-URL + client-IP resolution behind a reverse proxy/edge.
    // Officially required to be explicit for dynamic baseURL in better-auth 1.6.x;
    // keep true behind any proxy, false when the server receives direct traffic only.
    trustedProxyHeaders: env.TRUSTED_PROXY_HEADERS === 'true',

    ipAddress: {
      // Populate from TRUSTED_PROXY_CIDRS once we sit behind a real reverse proxy
      // (Cloudflare/NGINX) in Phase C. Untrusted x-forwarded-for values beyond a
      // trusted CIDR are ignored — prevents client-IP spoofing for rate limiting.
      ...(env.TRUSTED_PROXY_CIDRS
        ? { trustedProxies: env.TRUSTED_PROXY_CIDRS.split(',').map((s) => s.trim()).filter(Boolean) }
        : {}),
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
    resetPasswordTokenExpiresIn: PASSWORD_RESET_TOKEN_TTL_SECS,
    // Build OUR OWN link (app-root /auth/reset-password page) — BetterAuth's stock
    // url points at baseURL + /reset-password/:token which has no page in this repo
    // (would 404). issueResetEmail is catch-and-log by contract (never throws), so
    // SMTP failures cannot take the request down; the token row stays valid for
    // retry — same resilience as the OIDC invitation link.
    // Origin precedence: THIS request's origin wins (reset requests happen outside
    // a session, so lastRequest is frequently stale/absent); the session-captured
    // origin is only the off-request fallback.
    sendResetPassword: async ({ user, token }, request) => {
      try {
        await issueResetEmail(user, token, {
          portalOrigin: request ? new URL(request.url).origin : getLastRequestOrigin(),
        });
      } catch (err) {
        // Paranoia: the lib never throws by contract, but a throw here would
        // 500 the request after the token row is already written. Log + swallow.
        logger.error({ err, userId: user.id }, '[Auth] sendResetPassword hook failed (token remains valid)');
      }
    },
    // Observer hook — fires after BetterAuth has hashed + written the password and
    // deleted the Verification row atomically (design §7.3). Session revocation is
    // deliberately OUT of scope today (design §13 Q3); this is the audit point a
    // future extension wires to. Best-effort: must not break the reset response.
    onPasswordReset: async ({ user }) => {
      try {
        logger.info({ userId: user.id }, '[Auth] Password reset completed (local user)');
      } catch {
        // never — informational only, kept defensive so a logging outage can't 500
        // the endpoint whose happy path has already committed.
      }
    },
  },

  // OAuth callback API errors (incl. the signup-disabled rejection for uninvited
  // Google identities) land on the login page — where classifyGateMessage renders
  // the proper "not invited" banner — instead of better-auth's default /error URL
  // which has no route and 404s.
  onAPIError: {
    errorURL: '/login',
  },

  // Google OIDC sign-in. Default scopes (openid email profile); no offline access.
  //
  // INVITE-ONLY DOOR (design §4.3): better-auth's OAuth callback evaluates
  // `disableSignUp = provider.disableImplicitSignUp && !requestSignUp ||
  // provider.options?.disableSignUp` before auto-registering an unknown identity.
  // We set BOTH flags, so the second term keeps refusing sign-up even if a client
  // forges requestSignUp:true — handleOAuthUserInfo returns "signup disabled" and
  // the callback redirects to /login?error=signup_disabled with ZERO rows written
  // (no User, no Account, no email). Pre-registered invited users are unaffected:
  // findOAuthUser resolves them by email before any sign-up decision runs. The
  // stray-identity branch in enforceOidcProvisioning remains as defence-in-depth:
  // legacy rows created before this flag shipped (e.g. today's auto-registered
  // stranger from the old flow) are refused without an invitation email and their
  // orphan rows removed, and a future better-auth build that changes how options
  // reach the provider instance still cannot register strangers through the gate.
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      disableImplicitSignUp: true,
      disableSignUp: true,
    },
  },

  plugins: [
    // Bearer (Authorization: Bearer <token>) ⇄ session translation for
    // remote-domain / server-to-server clients. Converts the header to an internal
    // session cookie per request — all existing auth gates (ban, OIDC provisioning,
    // permissions callback) apply unchanged. Adds a set-auth-token response header
    // on session-setting responses so a token can be acquired programmatically.
    bearer(),
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
        before: async (session, ctx?: { request?: Request } | null) => {
          // Pre-invite: capture the origin this server is being reached on so
          // the emailed magic link points where the user actually logged in
          // (LAN IP / tunnel host / public domain — not a pinned FRONTEND_URL).
          // Verified empirically: better-auth's session.create.before receives
          // AuthEndpointContext, which carries the incoming request.
          lastRequest = ctx?.request ?? null;
          const user = await prisma.user.findUnique({
            where: { id: session.userId },
            select: { email: true },
          });
          if (!user) return; // BetterAuth guarantees the row exists; be defensive
          await enforceBanStatus(user.email);
          // Pre-registration gate (Google OIDC only — a no-op for users without
          // a google Account row, so email/password login is untouched).
          await enforceOidcProvisioning(session.userId);
        },
        after: async (session) => {
          // Observability (Task 7): GoogleOptions has no onSuccess/onError hooks in
          // better-auth@1.6.x, so mark social sign-ins here — the single point every
          // successful sign-in funnels through. One extra lookup, only when a google
          // Account row exists for the user.
          const hasGoogleAccount = await prisma.account.findFirst({
            where: { userId: session.userId, providerId: 'google' },
            select: { id: true },
          });
          if (hasGoogleAccount) {
            logger.info(
              { userId: session.userId, sessionId: session.id, provider: 'google' },
              '[Auth] Google sign-in succeeded',
            );
          }

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

          // Member is RLS-gated — the GUC-less base-client lookup returns zero
          // rows for everyone under nipp_app, so pin the platform context (see
          // withPlatformRead above); inside it tenantDb routes to the pinned
          // connection where the GUCs are visible.
          const member = await withPlatformRead(
            () => tenantDb.member.findFirst({ where: { userId: session.userId }, select: { orgId: true } }),
          );

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
