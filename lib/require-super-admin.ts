/**
 * Route guard: Require Super Admin (Platform Organization member).
 *
 * Import and call this function at the start of API routes that are
 * restricted to Super Admins. Returns a NextResponse error if the user
 * is not authorized, or null if access is granted.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getPlatformOrgId, isSuperAdmin as checkIsSuperAdmin } from '@/lib/authz';
import type { NextRequest } from 'next/server';

/**
 * Synchronous guard: call at the top of an API route handler.
 * Returns an error response if unauthorized, or null if authorized.
 */
export async function requireSuperAdmin(
  headers: Headers
): Promise<NextResponse | null> {
  const session = await auth.api.getSession({ headers });

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const isSuper = await checkIsSuperAdmin(session.user.id, undefined);

  if (!isSuper) {
    return NextResponse.json({ error: 'Forbidden: Super Admin access required' }, { status: 403 });
  }

  return null; // Authorized
}

/**
 * Get the current session, returning null if not authenticated.
 */
export async function getSession(headers: Headers) {
  return auth.api.getSession({ headers });
}

/**
 * Extract IP address and user agent from request.
 */
export function getRequestMetadata(request: NextRequest) {
  return {
    ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
    userAgent: request.headers.get('user-agent') || 'unknown',
  };
}
