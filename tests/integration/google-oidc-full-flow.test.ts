import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { MockInstance } from 'vitest';
import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { env } from '@/lib/env';
import { issueInviteLink } from '@/lib/oidc-magic-link';
import { hashPassword } from 'better-auth/crypto';
import { rlsFixture } from '@/tests/utils/rls-fixture';

// Mail seam mock: lib/oidc-magic-link imports sendEmail as an ESM live binding,
// so a post-hoc vi.spyOn on the imported name cannot intercept it. Mocking the
// module instead swaps in this recorder — every issueInviteLink call delegates
// to the REAL sendEmail (SMTP stub env) and appends to `sentInvites`; specs
// assert against that log + the Verification table row. vi.hoisted guarantees
// the binding exists before lib/auth's import chain loads.
const { sentInvites } = vi.hoisted(() => ({
  sentInvites: [] as Array<{ to: string; subject: string; message?: string }>,
}));
vi.mock('@/lib/notifications/email', () => ({
  sendEmail: (to: string, subject: string, message: string, _headerTitle?: string) => {
    sentInvites.push({ to, subject, message });
    return Promise.resolve({ success: true as const });
  },
}));

/**
 * Google OIDC — full mocked flow (Phase 3, Task 6) + success-log wiring (Task 7).
 *
 * Drives the REAL auth handler end-to-end without live Google credentials:
 *   1. POST /sign-in/social → BetterAuth persists the flow state (PKCE codeVerifier +
 *      callbackURL JSON blob) to the Verification table and sets a `state` value as
 *      its identifier; we read that back directly (database state strategy).
 *   2. GET /callback/google?code=fake&state=<that> → the ONLY outbound call is the
 *      OAuth token exchange to oauth2.googleapis.com/token, stubbed via
 *      vi.spyOn(globalThis, 'fetch'). We answer with an id_token built locally:
 *      BetterAuth's google provider derives the user from a plain decodeJwt of
 *      id_token — signature verification is NOT part of this code path (verified in
 *      node_modules: validate-authorization-code.mjs uses jose only for its own
 *      separate validateToken helper, not here), so an alg:none token passes.
 *   3. Assert user + Account rows and the session cookie; then GET /session with
 *      that cookie to confirm BetterAuth resolves a real session (which executes
 *      the ExtendedSession callbacks).
 *   4. Banned-user case: ban BEFORE (first) sign-in of a RETURNING google identity →
 *      handleOAuthUserInfo resolves the linked Account, then createSession runs our
 *      databaseHooks.session.create.before → throw APIError('UNAUTHORIZED') → BetterAuth
 *      answers the callback with 401 'Access denied. …' (the exact message the login
 *      page's banned banner recognises) and NO session row is created.
 */

const TEST_EMAIL = 'full-flow.google@example.com';
const BANNED_EMAIL = 'full-flow.banned@gmail.com';
const BANNED_INVITED_EMAIL = 'full-flow.banned-invited@gmail.com';
const GOOGLE_SUB = 'g-sub-full-flow';
const BANNED_SUB = 'g-sub-banned-flow';
const BANNED_INVITED_SUB = 'g-sub-banned-invited';
const CALLBACK_URL = 'http://localhost:3000/dashboard/calendar';

// Pre-registration gate (P1 Task 3) identities
const PENDING_EMAIL = 'full-flow.pending@gmail.com';
const PROVISIONED_EMAIL = 'full-flow.provisioned@gmail.com';
const PENDING_SUB = 'g-sub-pending-flow';
const PROVISIONED_SUB = 'g-sub-provisioned-flow';

// Local email/password regression identity (must sign in through the same hook chain)
const LOCAL_EMAIL = 'full-flow.local@example.com';
const LOCAL_PASSWORD = 'LocalRegression123!';

// BetterAuth's google provider derives the user from decodeJwt(id_token) ONLY —
// no signature check on this path (verified in node_modules — see file header) —
// so a locally built, UNVERIFIED JWT (alg:none compact form) is sufficient and
// needs no keypair: base64url(header).base64url(payload).empty-signature.
function buildIdToken(email: string, sub: string): string {
  const b64 = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ typ: 'JWT', alg: 'none' });
  const payload = b64({
    sub,
    name: 'Flow Google',
    email,
    email_verified: true,
    picture: '',
    given_name: 'Flow',
    family_name: 'Google',
    iss: 'https://accounts.google.com',
    iat: now,
    exp: now + 300,
  });
  return `${header}.${payload}.`;
}

// BetterAuth stores the OAuth flow state in the Verification table (database
// strategy is the default) — identifier holds the `state` value, value holds the
// JSON blob (codeVerifier, callbackURL, … custom keys). sign-in/social accepts
// `additionalData`, which we set to a unique marker so lookups stay deterministic
// even when other test files write their own state rows concurrently.
async function findOAuthState(marker: string): Promise<string> {
  const row = await prisma.verification.findFirst({ where: { value: { contains: marker } } });
  if (!row) throw new Error(`No Verification row carrying marker ${marker}`);
  return row.identifier;
}

/**
 * Pull named cookies off a Response's Set-Cookie header(s). BetterAuth prefixes
 * cookie names with `__Secure-` when the Secure flag applies (this build does —
 * verified in the debug trace), so match on a suffix and round-trip the original
 * name verbatim.
 */
function extractSetCookie(res: Response): {
  sessionToken: string | null;
  sessionCookieName: string | null;
  stateCookie: string | null;
} {
  const raw = res.headers.getSetCookie?.() ?? [];
  let sessionToken: string | null = null;
  let sessionCookieName: string | null = null;
  let stateCookie: string | null = null;
  for (const c of raw) {
    const pair = c.slice(0, c.indexOf(';'));
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (name.endsWith('better-auth.session_token')) { sessionToken = value; sessionCookieName = name; }
    // Signed state cookie the database state strategy cross-checks against.
    if (name.endsWith('.state')) stateCookie = pair;
  }
  return { sessionToken, sessionCookieName, stateCookie };
}

function socialSignInRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost:3000/api/auth/sign-in/social', {
    method: 'POST',
    headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Sign-in → mock callback; reads flow state from the Verification table. */
async function runOAuthRoundTrip(t: (req: Request) => Promise<Response>, body: Record<string, unknown>) {
  const marker = `flowmarker-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const signResponse = await t(socialSignInRequest({ ...body, additionalData: { flowMarker: marker } }));
  expect(signResponse.status >= 200 && signResponse.status < 400).toBe(true);
  expect(signResponse.headers.get('location') ?? '').toContain('accounts.google.com');
  await signResponse.body?.cancel();

  const state = await findOAuthState(marker);
  const cookies = extractSetCookie(signResponse).stateCookie;
  return t(
    new Request(
      `http://localhost:3000/api/auth/callback/google?code=fake-auth-code&state=${encodeURIComponent(state)}`,
      // The DB state strategy also cross-checks the signed state cookie set at sign-in.
      { headers: { Origin: 'http://localhost:3000', Cookie: cookies ?? '' } },
    ),
  );
}

/**
 * Parse a callback error redirect (?error=…&error_description=…) — the shape
 * BetterAuth produces once a session-creation hook throws an APIError WITH a
 * body.code (isAPIError && e.body?.code → redirectOnError onto errorCallbackURL).
 * Returns null when the response is not such a redirect.
 */
function parseCallbackErrorRedirect(res: Response): { error: string | null; description: string | null } | null {
  const loc = res.headers.get('location') ?? '';
  if (!loc) return null;
  const params = new URL(loc, 'http://localhost:3000').searchParams;
  if (!params.has('error')) return null;
  return { error: params.get('error'), description: params.get('error_description') };
}

// Identities this file drives through real callback round-trips (incl. the
// forged-signup identity, which only exists while its spec runs).
const ALL_FLOW_EMAILS = [
  TEST_EMAIL,
  BANNED_EMAIL,
  'full-flow.forged-signup@gmail.com',
  BANNED_INVITED_EMAIL,
  PENDING_EMAIL,
  PROVISIONED_EMAIL,
  LOCAL_EMAIL,
];

describe('Google OIDC — full mocked flow (Task 6)', () => {
  const handler = auth.handler as (req: Request) => Promise<Response>;
  let tokenFetchMock: MockInstance;
  let infoSpy: MockInstance;

  // Mail assertion target (hoisted mock — replace vi.spyOn, which can't intercept
  // the ESM live binding lib/oidc-magic-link imports).
  const clearSentInvites = () => { sentInvites.length = 0; };

  beforeAll(() => {
    // Stub the ONLY outbound call: the OAuth token exchange. Everything else must
    // never touch the network (it would hit Google with test creds and fail).
    tokenFetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: string | Request | URL) => {
        const url = String(input);
        if (url.includes('oauth2.googleapis.com/token')) {
          return new Response(
            JSON.stringify({
              access_token: 'mock-access-token',
              id_token: currentIdToken,
              token_type: 'Bearer',
              expires_in: 3600,
              scope: 'openid email profile',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        throw new Error(`Unexpected outbound request in mocked OAuth flow: ${url}`);
      });
    // Pino instance — spying on .info lets us assert the Task 7 success log line.
    infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
  });

  afterAll(async () => {
    tokenFetchMock.mockRestore();
    infoSpy.mockRestore();
    for (const email of ALL_FLOW_EMAILS) {
      const user = await prisma.user.findUnique({ where: { email } });
      if (user) await prisma.session.deleteMany({ where: { userId: user.id } });
    }
    // Expired/leftover invite tokens from gate rejections — match on our kind marker.
    await prisma.verification.deleteMany({ where: { value: { contains: '"oidc-invite"' } } });
    await prisma.account.deleteMany({
      where: { providerId: 'google', accountId: { in: [GOOGLE_SUB, BANNED_SUB, BANNED_INVITED_SUB, PENDING_SUB, PROVISIONED_SUB] } },
    });
    // Local regression identity's credential account.
    const localUser = await prisma.user.findUnique({ where: { email: LOCAL_EMAIL } });
    if (localUser) await prisma.account.deleteMany({ where: { userId: localUser.id, providerId: 'credential' } });
    // Seeded gate orgs — deleting an org cascades its Teams, TeamMembers and MemberRoles
    // (schema onDelete: Cascade), so the Members-team rows go with them. RLS:
    // Organization DELETE needs platform GUCs bound to the TARGET row's org id,
    // so resolve each org platform-scoped and delete it under its own context.
    const gateOrgs = await (rlsFixture(null) as unknown as typeof prisma).organization.findMany({
      where: { id: { startsWith: 'org-gate-' } },
    });
    for (const org of gateOrgs) {
      await (rlsFixture(org.id) as unknown as typeof prisma).organization.delete({ where: { id: org.id } });
    }
    await prisma.user.deleteMany({ where: { email: { in: ALL_FLOW_EMAILS } } });
  });

  /**
   * Seed an invited google user for gate specs, mirroring the EXACT shape that
   * UserService.create produces (the production "Create User" path — a passwordless
   * Google invite is always created INTO an organization with a Member row and
   * auto-enrolled in the org's default "Members" team; only the magic-link flag and
   * the linked google Account differ, and the Account is created on first callback).
   *
   * Default = FULLY provisioned (org + member + members team); flip `provisioned: false`
   * for the verified-but-no-membership edge case the "not provisioned" branch tests.
   * Returns the seeded userId so specs can assert sessions against it.
   */
  async function seedInvitedGoogleUser(opts: {
    email: string;
    sub: string;
    oidcVerified?: boolean;
    /** false → verified user with NO org membership (the "not provisioned" gate branch). Default true. */
    provisioned?: boolean;
  }) {
    const user = await prisma.user.upsert({
      where: { email: opts.email },
      create: { name: 'Gate User', email: opts.email, oidcVerified: opts.oidcVerified ?? false },
      update: { oidcVerified: opts.oidcVerified ?? false },
    });
    // Google account pre-linked to the user (what the first callback would attach via findOAuthUser).
    await prisma.account.upsert({
      where: { providerId_accountId: { providerId: 'google', accountId: opts.sub } },
      create: { accountId: opts.sub, providerId: 'google', userId: user.id },
      update: {},
    });

    if (opts.provisioned !== false) {
      // Create-User shape: org → Member row → default "Members" team enrollment.
      // RLS note: the test app role is nipp_app, so Organization/Member/Team
      // writes need platform GUCs — raw prisma ops fail closed (42501). Seed and
      // verify through the fixture handle (platform context per op); User/Account
      // are RLS-exempt and stay on the raw client.
      const orgId = `org-gate-${user.id}`;
      const seed = rlsFixture(null) as unknown as typeof prisma;
      await seed.organization.upsert({ where: { id: orgId }, create: { id: orgId, name: 'Gate Org' }, update: {} });
      // upsert (not create): specs in this file re-seed the same identities in different states.
      const work = rlsFixture(orgId) as unknown as typeof prisma;
      await work.member.upsert({
        where: { userId_orgId: { userId: user.id, orgId } },
        create: { userId: user.id, orgId },
        update: {},
      });
      // Default "Members" team (idempotent) + enroll the user in it.
      const membersTeam = (await work.team.upsert({
        where: { organizationId_slug: { organizationId: orgId, slug: 'members' } },
        create: { name: 'Members', slug: 'members', organizationId: orgId },
        update: {},
      })) as { id: string };
      await work.teamMember.upsert({
        where: { userId_teamId: { userId: user.id, teamId: membersTeam.id } },
        create: { userId: user.id, teamId: membersTeam.id, organizationId: orgId },
        update: {},
      });
    }
    return user.id;
  }

  it('STRANGER google identity (not invited) → rejected at callback, ZERO rows written, NO email', async () => {
    currentIdToken = buildIdToken(TEST_EMAIL, GOOGLE_SUB);
    clearSentInvites();

    const cbRes = await runOAuthRoundTrip(handler, { provider: 'google', callbackURL: CALLBACK_URL });
    // disableImplicitSignUp refuses the unknown identity BEFORE createOAuthUser
    // writes anything: better-auth redirects to its error page with the machine
    // code (which the login page turns into the not-invited banner).
    expect(cbRes.status).toBeGreaterThanOrEqual(300);
    expect(cbRes.status).toBeLessThan(400);
    const location = cbRes.headers.get('location') ?? '';
    expect(location).toContain('error=signup_disabled');
    expect(extractSetCookie(cbRes).sessionToken).toBeFalsy();

    // The whole point of the fix: nothing is persisted, no invitation email.
    const user = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
    expect(user).toBeNull();
    const accounts = await prisma.account.findMany({
      where: { providerId: 'google', accountId: GOOGLE_SUB },
    });
    expect(accounts.length).toBe(0);
    expect(sentInvites.length).toBe(0);
  }, 20000);

  it('FORGED requestSignUp:true on an uninvited identity → rejected at callback, ZERO rows written, NO email (defence-in-depth)', async () => {
    // Client can ask the sign-in endpoint to register a new user; better-auth
    // 1.6.23 evaluates `disableSignUp` as:
    //   provider.disableImplicitSignUp && !requestSignUp || provider.options?.disableSignUp
    // With BOTH disableImplicitSignUp and disableSignUp set in lib/auth.ts, the
    // second term is true regardless of requestSignUp — so a forged sign-up is
    // refused at handleOAuthUserInfo before createOAuthUser runs (zero rows).
    const FORGED_EMAIL = 'full-flow.forged-signup@gmail.com';
    const FORGED_SUB = 'g-sub-forged-flow';
    currentIdToken = buildIdToken(FORGED_EMAIL, FORGED_SUB);
    clearSentInvites();

    const cbRes = await runOAuthRoundTrip(handler, {
      provider: 'google',
      callbackURL: CALLBACK_URL,
      requestSignUp: true,
    });
    // Same early rejection as the plain stranger case.
    expect(cbRes.status).toBeGreaterThanOrEqual(300);
    expect(cbRes.status).toBeLessThan(400);
    const location = cbRes.headers.get('location') ?? '';
    expect(location).toContain('error=signup_disabled');
    expect(extractSetCookie(cbRes).sessionToken).toBeFalsy();

    // No rows, no invitation email.
    const user = await prisma.user.findUnique({ where: { email: FORGED_EMAIL } });
    expect(user).toBeNull();
    const accounts = await prisma.account.findMany({
      where: { providerId: 'google', accountId: FORGED_SUB },
    });
    expect(accounts.length).toBe(0);
    expect(sentInvites.length).toBe(0);
  }, 20000);

  it('INVITED user, magic link not clicked (oidcVerified=false) → rejected + invitation email issued', async () => {
    const userId = await seedInvitedGoogleUser({ email: PENDING_EMAIL, sub: PENDING_SUB });
    currentIdToken = buildIdToken(PENDING_EMAIL, PENDING_SUB);
    clearSentInvites();

    const cbRes = await runOAuthRoundTrip(handler, {
      provider: 'google',
      callbackURL: CALLBACK_URL,
      errorCallbackURL: '/login',
    });
    // The gate's APIError carries a body.code → BetterAuth redirects (302) to
    // the login page with ?error=&error_description= — where the mount effect
    // classifies it into the needs-inbox-check banner. A raw JSON 401 page was
    // the bug this exists to prevent.
    expect(cbRes.status).toBe(302);
    const redirect = parseCallbackErrorRedirect(cbRes);
    expect(redirect, 'callback should be an ?error= redirect').toBeTruthy();
    expect(redirect?.description ?? '').toMatch(/check your inbox|verification link/i);
    expect(extractSetCookie(cbRes).sessionToken).toBeFalsy();

    // A consumable token landed in the Verification table (the magic link).
    const inviteRows = await prisma.verification.findMany({ where: { value: { contains: '"oidc-invite"' } } });
    const ours = inviteRows.filter(
      (r) => r.expiresAt > new Date() && JSON.parse(r.value).email === PENDING_EMAIL,
    );
    expect(ours.length).toBeGreaterThanOrEqual(1);

    // Email seam fired for this user.
    expect(sentInvites.map((s) => s.to)).toContain(PENDING_EMAIL);

    const sessions = await prisma.session.findMany({ where: { userId } });
    expect(sessions.length).toBe(0);
  }, 20000);

  it('invitation link + subject follow the host the user reached (LAN IP), not a pinned FRONTEND_URL', async () => {
    // PUBLIC ACCESS pin: a visitor on http://192.168.99.5:3000 must get a magic
    // link built on THAT origin in both the button href and the fallback text —
    // never localhost (the FRONTEND_URL). The session-creation hook derives the
    // origin from ctx.request of this very callback round-trip.
    const LAN_ORIGIN = 'http://192.168.99.5:3000';
    const userId = await seedInvitedGoogleUser({ email: PENDING_EMAIL, sub: PENDING_SUB });
    currentIdToken = buildIdToken(PENDING_EMAIL, PENDING_SUB);
    clearSentInvites();

    const marker = `lanpin-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const signResponse = await handler(
      new Request(`${LAN_ORIGIN}/api/auth/sign-in/social`, {
        method: 'POST',
        headers: { Origin: LAN_ORIGIN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'google', callbackURL: `${LAN_ORIGIN}/dashboard/calendar`, additionalData: { flowMarker: marker } }),
      }),
    );
    expect(signResponse.status >= 200 && signResponse.status < 400).toBe(true);
    await signResponse.body?.cancel();

    const state = await findOAuthState(marker);
    const cookies = extractSetCookie(signResponse).stateCookie;
    const cbRes = await handler(
      new Request(`${LAN_ORIGIN}/api/auth/callback/google?code=fake-auth-code&state=${encodeURIComponent(state)}`, {
        headers: { Origin: LAN_ORIGIN, Cookie: cookies ?? '' },
      }),
    );
    // Gate rejects — now as a ?error= redirect onto errorCallbackURL (the APIError
    // carries a body.code), not the raw 401 JSON page.
    expect(parseCallbackErrorRedirect(cbRes)).toBeTruthy();

    const invite = sentInvites.find((s) => s.to === PENDING_EMAIL);
    expect(invite).toBeTruthy();
    if (!invite) return;
    expect(String(invite.subject)).toBe('NIPP account activation');
    const msg = String(invite.message ?? '');
    // Button href + fallback link both on the LAN origin, nowhere localhost.
    expect(msg.includes(`${LAN_ORIGIN}/auth/magic-link/verify`)).toBe(true);
    expect(msg).not.toContain('localhost:3000/auth/magic-link');

    const sessions = await prisma.session.findMany({ where: { userId } });
    expect(sessions.length).toBe(0);
  }, 20000);

  it('INVITED + VERIFIED user WITHOUT org membership → rejected (not provisioned)', async () => {
    const userId = await seedInvitedGoogleUser({ email: PROVISIONED_EMAIL, sub: PROVISIONED_SUB, oidcVerified: true, provisioned: false });
    currentIdToken = buildIdToken(PROVISIONED_EMAIL, PROVISIONED_SUB);
    clearSentInvites();

    const cbRes = await runOAuthRoundTrip(handler, { provider: 'google', callbackURL: CALLBACK_URL });
    expect(cbRes.status).toBe(302);
    const redirect = parseCallbackErrorRedirect(cbRes);
    expect(redirect, 'callback should be an ?error= redirect').toBeTruthy();
    expect(redirect?.description ?? '').toContain('provisioned');
    expect(extractSetCookie(cbRes).sessionToken).toBeFalsy();

    // Verification gate passed ⇒ no re-send of an invitation email.
    expect(sentInvites.length).toBe(0);

    const sessions = await prisma.session.findMany({ where: { userId } });
    expect(sessions.length).toBe(0);
  }, 20000);

  it('INVITED + VERIFIED + ORG user → full sign-in succeeds (cookie + session)', async () => {
    const userId = await seedInvitedGoogleUser({ email: PROVISIONED_EMAIL, sub: PROVISIONED_SUB, oidcVerified: true });
    currentIdToken = buildIdToken(PROVISIONED_EMAIL, PROVISIONED_SUB);

    const cbRes = await runOAuthRoundTrip(handler, { provider: 'google', callbackURL: CALLBACK_URL });
    expect(cbRes.status).toBe(302);
    expect(cbRes.headers.get('location')).toBe(CALLBACK_URL);

    const { sessionToken, sessionCookieName } = extractSetCookie(cbRes);
    expect(sessionToken, 'session cookie should be set for fully provisioned user').toBeTruthy();
    await cbRes.body?.cancel();

    const sessions = await prisma.session.findMany({ where: { userId } });
    expect(sessions.length).toBeGreaterThan(0);
  }, 20000);

  it('CONSUME → RE-SIGN-IN arc: link consumption flips the gate, second sign-in succeeds end-to-end', async () => {
    // The product contract in one spec: an invited-but-unverified Google user
    // is blocked (the prior spec), and the SAME identity passes once its magic
    // link has been consumed. Drives the real verify route to flip the flag —
    // no manual DB writes — so a regression in consume/markVerified/or the
    // gate would each break this arc.
    const userId = await seedInvitedGoogleUser({ email: PENDING_EMAIL, sub: PENDING_SUB });
    currentIdToken = buildIdToken(PENDING_EMAIL, PENDING_SUB);

    const issued = await issueInviteLink({ id: userId, name: 'Pending Flow', email: PENDING_EMAIL });
    if (!issued.ok) throw new Error(`invite link should issue in test env: ${issued.error}`);

    // 1. Blocked before consumption (gate #2: unverified) — now as a ?error= redirect.
    clearSentInvites();
    const blockedRes = await runOAuthRoundTrip(handler, { provider: 'google', callbackURL: CALLBACK_URL });
    expect(parseCallbackErrorRedirect(blockedRes)?.description ?? '').toMatch(/check your inbox|verification link/i);

    // 2. Consume OUR issued token through the real verify route — it flips
    //    oidcVerified for the identity (the gate's own re-issued links don't
    //    matter; any consumed link marks the user verified).
    const { GET } = await import('@/app/auth/magic-link/verify/route');
    const verifyRes = await GET(new NextRequest(`${env.FRONTEND_URL}/auth/magic-link/verify?token=${issued.token}`));
    expect(verifyRes.status).toBe(307);
    expect(verifyRes.headers.get('location')).toContain('/login?oidc=link-verified');

    // 3. Same identity, second Google sign-in — the gate now passes.
    const cbRes = await runOAuthRoundTrip(handler, { provider: 'google', callbackURL: CALLBACK_URL });
    expect(cbRes.status).toBe(302);
    expect(cbRes.headers.get('location')).toBe(CALLBACK_URL);
    expect(extractSetCookie(cbRes).sessionToken, 'consumed link must unblock the second sign-in').toBeTruthy();
    await cbRes.body?.cancel();

    const sessions = await prisma.session.findMany({ where: { userId } });
    expect(sessions.length).toBeGreaterThan(0);
  }, 30000);

  it('returning verified user → session again, NO invitation email re-sent (idempotent gate)', async () => {
    const userId = await seedInvitedGoogleUser({ email: PROVISIONED_EMAIL, sub: PROVISIONED_SUB, oidcVerified: true });
    // Wipe sessions from the happy-path spec so this is a clean re-login.
    await prisma.session.deleteMany({ where: { userId } });
    currentIdToken = buildIdToken(PROVISIONED_EMAIL, PROVISIONED_SUB);
    clearSentInvites();

    const cbRes = await runOAuthRoundTrip(handler, { provider: 'google', callbackURL: CALLBACK_URL });
    expect(cbRes.status).toBe(302);
    expect(extractSetCookie(cbRes).sessionToken).toBeTruthy();
    await cbRes.body?.cancel();

    // A verified+provisioned identity never re-enters the email path.
    expect(sentInvites.length).toBe(0);
  }, 30000);

  it('EMAIL/PASSWORD sign-in is untouched — local user gets a session via the same hook chain', async () => {
    // Hard invariant: the pre-registration gate must be a no-op for identities
    // without a Google account. This drives the real /sign-in/email path end-to-end
    // (same databaseHooks.session.create.before funnel) so any regression that
    // touches local login fails here in CI.
    const emailTestUser = await prisma.user.upsert({
      where: { email: LOCAL_EMAIL },
      create: { name: 'Local Regression', email: LOCAL_EMAIL },
      update: {},
    });
    // Canonical credential account (same shape tests/utils/factories.ts produces).
    await prisma.account.upsert({
      where: { providerId_accountId: { providerId: 'credential', accountId: emailTestUser.id } },
      create: { userId: emailTestUser.id, accountId: emailTestUser.id, providerId: 'credential', password: await hashPassword(LOCAL_PASSWORD) },
      update: {},
    });

    const signInRes = await handler(new Request('http://localhost:3000/api/auth/sign-in/email', {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: LOCAL_EMAIL, password: LOCAL_PASSWORD }),
    }));

    expect(signInRes.status).toBe(200);
    const payload = await signInRes.json();
    expect(payload.token).toBeTruthy(); // BetterAuth email sign-in returns the token inline

    const sessions = await prisma.session.findMany({ where: { userId: emailTestUser.id } });
    expect(sessions.length).toBeGreaterThan(0);
  }, 20000);

  it('banned user is rejected at session creation — no session, redirect to /login with the banned message', async () => {
    // Seed a returning google user who is banned BEFORE this sign-in.
    await prisma.user.upsert({
      where: { email: BANNED_EMAIL },
      create: { name: 'Banned Flow', email: BANNED_EMAIL, banned: true, banReason: 'Fraud', banExpires: new Date(Date.now() + 86400_000) },
      update: {},
    });
    const seeded = await prisma.user.findUnique({ where: { email: BANNED_EMAIL } });
    await prisma.account.upsert({
      where: { providerId_accountId: { providerId: 'google', accountId: BANNED_SUB } },
      create: { accountId: BANNED_SUB, providerId: 'google', userId: seeded!.id },
      update: {},
    });

    currentIdToken = buildIdToken(BANNED_EMAIL, BANNED_SUB);

    const cbRes = await runOAuthRoundTrip(handler, {
      provider: 'google',
      callbackURL: CALLBACK_URL,
      errorCallbackURL: '/login',
    });

    // session.create.before threw APIError('UNAUTHORIZED', { code }) — BetterAuth
    // redirects (302) to the login page with ?error=…&error_description='Access
    // denied. …' for the banned banner. The old behaviour was a raw 401 JSON body
    // on the callback page (the bug this spec now pins against).
    expect(cbRes.status).toBe(302);
    const redirect = parseCallbackErrorRedirect(cbRes);
    expect(redirect, 'callback should be an ?error= redirect').toBeTruthy();
    expect(redirect?.description ?? '').toContain('Access denied');
    // No session cookie is issued for the rejected identity.
    expect(extractSetCookie(cbRes).sessionToken).toBeFalsy();

    // No session was issued for the banned user.
    const sessions = await prisma.session.findMany({ where: { userId: seeded!.id } });
    expect(sessions.length).toBe(0);
  }, 20000);

  it('banned + unverified invited user → ban wins (no invitation email — gate ordering)', async () => {
    // Order inside session.create.before is a product decision (Phase 1 note #3):
    // the ban check MUST run before the provisioning gate, so a banned identity
    // sees the ban message and no pointless activation email.
    const userId = await seedInvitedGoogleUser({ email: BANNED_INVITED_EMAIL, sub: BANNED_INVITED_SUB });
    await prisma.user.update({
      where: { id: userId },
      data: { banned: true, banReason: 'Fraud', banExpires: new Date(Date.now() + 86400_000) },
    });
    currentIdToken = buildIdToken(BANNED_INVITED_EMAIL, BANNED_INVITED_SUB);
    clearSentInvites();

    const cbRes = await runOAuthRoundTrip(handler, { provider: 'google', callbackURL: CALLBACK_URL });
    // Ban message (the seeded banReason), NOT the magic-link / provisioned variants.
    const redirect = parseCallbackErrorRedirect(cbRes);
    expect(redirect, 'callback should be an ?error= redirect').toBeTruthy();
    expect(redirect?.description ?? '').toContain('Access denied');
    expect(redirect?.description ?? '').toContain('Fraud');
    expect(redirect?.description ?? '').not.toMatch(/check your inbox|verification link/i);
    expect(extractSetCookie(cbRes).sessionToken).toBeFalsy();

    // No invitation email went out for a banned identity.
    expect(sentInvites.length).toBe(0);

    const sessions = await prisma.session.findMany({ where: { userId } });
    expect(sessions.length).toBe(0);
  }, 20000);
});

// Identity whose id_token the mocked token endpoint returns; set by each test right
// before its round-trip (the endpoint is stubbed once in beforeAll).
let currentIdToken = '';
