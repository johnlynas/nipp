import { auth } from '@/lib/auth';
import { headers as nextHeaders } from 'next/headers';
import { verifySuperAdmin } from '@/lib/authz';
import { logger } from '@/lib/logger';

/**
 * Middleware helper to require Super Admin privileges.
 * Fails CLOSED on database errors. No email fallbacks.
 * Accepts optional Headers for testability (falls back to next/headers).
 */
export async function requireSuperAdmin(requestHeaders?: Headers) {
  const session = await auth.api.getSession({ headers: requestHeaders || await nextHeaders() });

  if (!session) {
    logger.warn({ route: 'requireSuperAdmin' }, 'No session found');
    return { session: null, authorized: false, error: 'Unauthorized', status: 401 };
  }

  // Use the centralized, fail-closed verification
  const { authorized, error } = await verifySuperAdmin(session.user.id, undefined);

  if (!authorized) {
    // Detect if the failure was due to a DB outage vs actual lack of permissions
    const isDbError = error?.includes('Database unavailable') || error?.includes('Platform organization not found');
    const status = isDbError ? 503 : 403;

    logger.warn(
      { userId: session.user.id, error, status },
      'Super admin verification failed'
    );

    return {
      session,
      authorized: false,
      error: error || 'Super Admin access required',
      status,
    };
  }

  return { session, authorized: true, status: 200 };
}
