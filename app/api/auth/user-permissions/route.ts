/**
 * GET /api/auth/user-permissions
 *
 * Returns the current user's flattened permission list as JSON.
 * Used by React Query hooks (usePermissions) to avoid redundant session lookups.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getPlatformOrgId, isSuperAdmin } from '@/lib/authz';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      return NextResponse.json([], { status: 200 });
    }

    const user = session.user as any;

    // Fast path: permissions already resolved in session
    if (user.permissions && Array.isArray(user.permissions)) {
      return NextResponse.json(user.permissions);
    }

    // Slow path: resolve permissions on-demand
    try {
      const platformOrgId = await getPlatformOrgId();
      if (platformOrgId) {
        const isAdmin = await isSuperAdmin(user.id, platformOrgId);
        if (isAdmin) {
          return NextResponse.json(['*']);
        }
      }

      // Fall back to org-specific permissions if active org is set
      const { resolvePermissions } = await import('@/lib/permissions/resolver');
      if (session.activeOrganizationId) {
        const permissions = await resolvePermissions(user.id, session.activeOrganizationId);
        return NextResponse.json(permissions);
      }
    } catch (error) {
      console.error('[Permissions API] Failed to resolve permissions:', error);
    }

    return NextResponse.json([], { status: 200 });
  } catch (_error) {
    // Return empty array on error — React Query will retry with exponential backoff
    return NextResponse.json([], { status: 200 });
  }
}
