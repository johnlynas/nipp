import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import globalDb from '@/lib/global-db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * GET /api/auth/me
 * Returns the current user's session info including active organization ID.
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

  // Fallback: read from User model (where we set it via databaseHooks)
  if (!activeOrgId) {
    logger.info(
      { userId: session.user.id },
      '[/api/auth/me] Not in session — reading from User model',
    );

    const user = await globalDb.user.findUnique({
      where: { id: session.user.id },
      select: { activeOrganizationId: true },
    });

    activeOrgId = user?.activeOrganizationId ?? null;

    logger.info(
      { userId: session.user.id, fromUserModel: activeOrgId },
      '[/api/auth/me] activeOrganizationId from User model',
    );
  }

  logger.info(
    { userId: session.user.id, finalActiveOrgId: activeOrgId },
    '[/api/auth/me] Returning response',
  );

  const organization = activeOrgId
    ? await globalDb.organization.findUnique({ where: { id: activeOrgId }, select: { name: true } })
    : null;

  return NextResponse.json({
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    activeOrganizationId: activeOrgId,
    organizationName: organization?.name || '',
  });
}
