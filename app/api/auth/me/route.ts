import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
// RLS Phase 3: user/organization are unscoped (no RLS policy) — under the app
// role they need a platform context bind. Verified session user only.
import tenantDb from '@/lib/tenant-db';
import { withPlatformContext } from '@/lib/platform-db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * GET /api/auth/me
 * Returns the current user's session info: active organization ID + name and
 * userType ('OIDC' when User.oidcVerified is true, i.e. a verified Google
 * identity; 'Local' otherwise) for the account menu's User Info modal.
 */
export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  logger.info(
    { userId: session.user.id, userEmail: session.user.email },
    '[/api/auth/me] Fetching activeOrganizationId',
  );

  // Better Auth organization plugin stores activeOrganizationId on session.session
  const sessionRecord = session as Record<string, unknown>;
  let activeOrgId = (sessionRecord.session as Record<string, string | null>)?.activeOrganizationId ?? null;

  logger.info(
    { userId: session.user.id, fromSession: activeOrgId },
    '[/api/auth/me] activeOrganizationId from session',
  );

  // The DB read serves two fields: activeOrganizationId (session carries it on
  // most sign-ins; DB is the fallback) and oidcVerified (exists ONLY in the
  // User table — drives the "User Type" row of the account menu's User Info
  // modal). One indexed PK lookup, merged with the session value above.
  const user = await withPlatformContext(session.user.id, () =>
    tenantDb.user.findUnique({
      where: { id: session.user.id },
      select: { activeOrganizationId: true, oidcVerified: true },
    }),
  );

  if (!activeOrgId) {
    activeOrgId = user?.activeOrganizationId ?? null;
  }

  // Design §4.3: OIDC users complete magic-link verification which sets the
  // flag at consumption (lib/oidc-magic-link.ts). Everything else — local
  // credential accounts, invite-pending Google identities — is "Local".
  const userType: 'OIDC' | 'Local' = user?.oidcVerified === true ? 'OIDC' : 'Local';

  logger.info(
    { userId: session.user.id, finalActiveOrgId: activeOrgId, userType },
    '[/api/auth/me] Returning response',
  );

  // Platform org id context: the Organization SELECT policy admits
// `id = current_org OR platform`. This user's own org is admitted via the
// flag (platform admin visibility) — same semantics as before.
  const organization = activeOrgId
    ? await withPlatformContext(session.user.id, () =>
        tenantDb.organization.findUnique({ where: { id: activeOrgId }, select: { name: true } }))
    : null;

  // hasPassword feeds the account menu's "Change Password" item: only users
  // with a local email/password credential can change it. Checked against the
  // credential Account row (same source of truth /api/auth/password uses),
  // never User.passwordHash — legacy rows may differ.
  const credential = await withPlatformContext(session.user.id, () =>
    tenantDb.account.findFirst({
      where: { userId: session.user.id, providerId: 'credential' },
      select: { id: true },
    }),
  );

  return NextResponse.json({
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    activeOrganizationId: activeOrgId,
    organizationName: organization?.name || '',
    userType,
    hasPassword: !!credential,
  });
}
