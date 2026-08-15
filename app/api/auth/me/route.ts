import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

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

  // Better Auth organization plugin stores activeOrganizationId on session.session
  const sessionRecord = session as Record<string, unknown>;
  const activeOrgId = (sessionRecord.session as Record<string, string | null>)?.activeOrganizationId ?? null;

  return NextResponse.json({
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    activeOrganizationId: activeOrgId,
  });
}
