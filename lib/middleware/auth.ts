import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { logger } from '@/lib/logger';

export type AuthContext = {
  user: any;
  session: any;
};

export type AuthMiddlewareHandler = (
  request: NextRequest,
  context: AuthContext
) => Promise<Response | NextResponse> | Response | NextResponse;

/**
 * A higher-order function to wrap Next.js API route handlers with authentication logic.
 */
export function withAuth(handler: AuthMiddlewareHandler) {
  return async (request: NextRequest) => {
    try {
      // 1. Get Session
      const session = await auth.api.getSession({
        headers: await headers()
      });

      if (!session) {
        logger.warn({ method: request.method, url: request.url }, 'Unauthorized access attempt: No session');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      // 2. Execute Handler with context
      return await handler(request, {
        user: session.user,
        session: session.session,
      });

    } catch (error) {
      logger.error({ err: error, url: request.url }, 'Unexpected error in auth middleware');
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  };
}

/**
 * A specialized wrapper for Super Admin protected routes.
 */
export function withSuperAdmin(handler: AuthMiddlewareHandler) {
  return withAuth(async (request, context) => {
    const { verifySuperAdmin } = await import('@/lib/authz');

    const { authorized, error } = await verifySuperAdmin(context.user.id);

    if (!authorized) {
      const isDbError = error?.includes('Database unavailable');
      const status = isDbError ? 503 : 403;

      logger.warn({
        userId: context.user.id,
        error,
        status,
        url: request.url
      }, 'Super Admin authorization failed');

      return NextResponse.json({ error: error || 'Super Admin access required' }, { status });
    }

    // SECURITY (S7): Mark this request as super-admin context so getGlobalDb()
    // allows access to the unscoped Prisma client.
    const { setSuperAdminContext } = await import('@/lib/global-db-guard');
    setSuperAdminContext();

    return handler(request, context);
  });
}
