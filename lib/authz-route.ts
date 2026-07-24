/**
 * API route authorization wrappers.
 *
 * Provides higher-order functions for protecting API routes with
 * permission checks and Platform Organization security constraints.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import * as authz from './authz';

// ---------------------------------------------------------------------------
// Request context extraction
// ---------------------------------------------------------------------------

/**
 * Extract the authenticated user and organization ID from a Next.js request.
 * Returns null if the user is not authenticated.
 */
export async function getAuthContext(
  req: NextRequest
): Promise<{ userId: string; orgId: string } | null> {
  const session = await auth.api.getSession({ headers: req.headers });

  if (!session?.user) return null;

  // Get the active organization from headers or query params
  const orgId =
    req.headers.get('x-org-id') ||
    new URL(req.url).searchParams.get('orgId') ||
    '';

  if (!orgId) {
    return { userId: session.user.id, orgId: '' };
  }

  return { userId: session.user.id, orgId };
}

// ---------------------------------------------------------------------------
// Permission-based route protection
// ---------------------------------------------------------------------------

/**
 * Wrap an API route handler to require a specific permission.
 *
 * @param requiredPermission - The permission key required (e.g., 'properties:create')
 * @param handler - The API route handler to wrap
 * @returns A new handler that checks permissions before executing
 */
export function requirePermission(
  requiredPermission: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): (handler: any) => any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (handler: any) => async (req: NextRequest, ...args: any[]) => {
    const context = await getAuthContext(req);

    if (!context) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { userId, orgId } = context;

    if (!orgId) {
      return NextResponse.json(
        { error: 'Organization context required' },
        { status: 400 }
      );
    }

    const hasAccess = await authz.hasPermission(userId, orgId, requiredPermission);

    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Forbidden: insufficient permissions' },
        { status: 403 }
      );
    }

    return handler(req, ...args);
  };
}

/**
 * Wrap an API route to require ANY of the specified permissions.
 */
export function requireAnyPermission(permissions: string[]) {
  return (handler: any) => async (req: NextRequest, ...args: any[]) => {
    const context = await getAuthContext(req);

    if (!context) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { userId, orgId } = context;

    if (!orgId) {
      return NextResponse.json(
        { error: 'Organization context required' },
        { status: 400 }
      );
    }

    let hasAny = false;
    for (const permission of permissions) {
      if (await authz.hasPermission(userId, orgId, permission)) {
        hasAny = true;
        break;
      }
    }

    if (!hasAny) {
      return NextResponse.json(
        { error: 'Forbidden: insufficient permissions' },
        { status: 403 }
      );
    }

    return handler(req, ...args);
  };
}

// ---------------------------------------------------------------------------
// Platform Organization security constraint (3.3)
// ---------------------------------------------------------------------------

/**
 * Wrap an API route to enforce the Platform Organization security constraint.
 *
 * Blocks any mutation (POST/PUT/PATCH/DELETE) if the target organization ID
 * matches the Platform Organization, unless the requester is a Super Admin.
 */
export function requireNonPlatformOrgRoute() {
  return (handler: any) => async (req: NextRequest, ...args: any[]) => {
    const context = await getAuthContext(req);

    if (!context) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { userId, orgId } = context;

    // Only enforce on mutation methods
    const method = req.method.toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return handler(req, ...args);
    }

    // SECURITY (S6): No org context on a mutation — deny instead of passing through.
    // Previously this returned handler(req) which allowed mutations to execute without
    // any org-level authorization when the caller omitted the org context.
    if (!orgId) {
      return NextResponse.json(
        { error: 'Organization context required' },
        { status: 400 }
      );
    }

    // Check if this is the Platform Organization
    const platformOrgId = await authz.getPlatformOrgId();
    if (orgId === platformOrgId) {
      // Super Admins are allowed
      const isSuper = await authz.isSuperAdmin(userId, orgId);

      if (!isSuper) {
        return NextResponse.json(
          { error: 'Forbidden: Platform Organization is protected' },
          { status: 403 }
        );
      }
    }

    return handler(req, ...args);
  };
}
