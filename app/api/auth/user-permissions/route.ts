/**
 * GET /api/auth/user-permissions
 *
 * Returns the current user's flattened permission list as JSON.
 * Used by React Query hooks (usePermissions) to avoid redundant session lookups.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getPlatformOrgId, isSuperAdmin } from '@/lib/authz';
import { wrapPiiRoute } from '@/lib/payload-middleware';

export const runtime = 'nodejs';

// User-specific permissions must never be cached (P7 - dynamic data)
export const revalidate = 0;

// ---------------------------------------------------------------------------
// GET — Fetch user permissions (wrapped with payload encryption)
// ---------------------------------------------------------------------------

// skipEncryptionForUnauthenticated: unauthenticated requests return an empty array (no PII)
export const GET = wrapPiiRoute(
  async () => {
  // decryptedBody is null for GET requests

  try {
    const session = await auth.api.getSession({ headers: await headers() });

    if (!session?.user) {
      return NextResponse.json([], { status: 200, headers: { 'Cache-Control': 'no-store' } });
    }

    const user = session.user as { id: string; permissions?: string[] };

    // Fast path: permissions already resolved in session
    if (user.permissions && Array.isArray(user.permissions)) {
      return NextResponse.json(user.permissions, { headers: { 'Cache-Control': 'no-store' } });
    }

    // Slow path: resolve permissions on-demand
    try {
      const platformOrgId = await getPlatformOrgId();
      if (platformOrgId) {
        const isAdmin = await isSuperAdmin(user.id, platformOrgId);
        if (isAdmin) {
          return NextResponse.json(['*'], { headers: { 'Cache-Control': 'no-store' } });
        }
      }

      // Fall back to org-specific permissions if active org is set
      const { resolvePermissions } = await import('@/lib/permissions/resolver');
      if (session.session.activeOrganizationId) {
        const permissions = await resolvePermissions(user.id, session.session.activeOrganizationId);
        return NextResponse.json(permissions, { headers: { 'Cache-Control': 'no-store' } });
      }
    } catch (error) {
      console.error('[Permissions API] Failed to resolve permissions:', error);
    }

    return NextResponse.json([], { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (_error) {
    // Return empty array on error — React Query will retry with exponential backoff
    return NextResponse.json([], { status: 200 });
  }
},
  { skipEncryptionForUnauthenticated: true },
);
