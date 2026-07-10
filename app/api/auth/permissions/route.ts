import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { resolvePermissions } from '@/lib/permissions/resolver';
import { getPlatformOrgId } from '@/lib/authz';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      console.log('[Permissions API] No session');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[Permissions API] Session user ID:', session.user.id);

    // Fetch activeOrganizationId directly from User table
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { activeOrganizationId: true },
    });

    console.log('[Permissions API] User activeOrganizationId:', user?.activeOrganizationId);

    const orgId = user?.activeOrganizationId;
    
    if (!orgId) {
      console.log('[Permissions API] No activeOrganizationId found for user');
      return NextResponse.json({ permissions: [], isSuperAdmin: false });
    }

    // Resolve permissions
    const permissions = await resolvePermissions(session.user.id, orgId);
    console.log('[Permissions API] Resolved permissions:', permissions);

    const platformOrgId = await getPlatformOrgId();
    console.log('[Permissions API] Platform orgId:', platformOrgId);
    console.log('[Permissions API] Current orgId:', orgId);
    console.log('[Permissions API] Is Super Admin:', orgId === platformOrgId);

    const isSuperAdmin = orgId === platformOrgId;

    return NextResponse.json({ permissions, isSuperAdmin });
  } catch (error) {
    console.error('[Permissions API] Error:', error);
    return NextResponse.json({ permissions: [], isSuperAdmin: false });
  }
}