import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { resolvePermissions } from '@/lib/permissions/resolver';
import { getPlatformOrgId } from '@/lib/authz';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const orgId = session.session.activeOrganizationId;
    if (!orgId) {
      return NextResponse.json({ permissions: [], isSuperAdmin: false });
    }

    const permissions = await resolvePermissions(session.user.id, orgId);
    const platformOrgId = await getPlatformOrgId();
    const isSuperAdmin = orgId === platformOrgId;

    return NextResponse.json({ permissions, isSuperAdmin });
  } catch (error) {
    console.error('[Permissions API] Error:', error);
    return NextResponse.json({ permissions: [], isSuperAdmin: false });
  }
}