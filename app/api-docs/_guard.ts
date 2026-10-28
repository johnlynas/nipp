/**
 * Super-admin gate + rate limit for the /api-docs Swagger UI, spec, and asset endpoints.
 *
 * Middleware no longer treats /api-docs as public — unauthenticated requests
 * are redirected to /login before reaching the route handlers. This guard is
 * the authoritative check: only members of the Platform organization (super
 * admins) get a 200; everyone else gets JSON 401/403 and no content. The check
 * is fail-closed — any error resolving super-admin status denies access.
 *
 * Authenticated super admins are additionally rate-limited to
 * API_DOCS_RATE_LIMIT_MAX requests per window (env-tunable) across all three
 * endpoints — further calls get 429 with a Retry-After header.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { isSuperAdmin } from '@/lib/authz';
import { checkApiDocsRateLimit, API_DOCS_RATE_LIMIT_MAX, API_DOCS_RATE_LIMIT_WINDOW } from '@/lib/rate-limiter';

/**
 * Returns a Response to reject the request, or null when the caller is a
 * verified super admin and may proceed.
 */
export async function requireSuperAdmin(request: Request): Promise<Response | null> {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Rate limit by session (shared across UI page, spec and assets requests):
  // API_DOCS_RATE_LIMIT_MAX per window. Applied after authentication so
  // unauthenticated spam is rejected by the middleware redirect instead;
  // throttling also protects the super-admin DB check from being hammered.
  const sessionId = (session.session as { id?: string }).id;
  if (!sessionId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!checkApiDocsRateLimit(`session:${sessionId}`)) {
    return NextResponse.json(
      {
        error: 'rate_limited',
        message: `Too many requests — limit is ${API_DOCS_RATE_LIMIT_MAX} per ${API_DOCS_RATE_LIMIT_WINDOW}s`,
        retryAfter: API_DOCS_RATE_LIMIT_WINDOW,
      },
      { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(API_DOCS_RATE_LIMIT_WINDOW) } },
    );
  }

  // The BetterAuth session callback resolves isSuperAdmin from the database on
  // every getSession() call (Node runtime), so an explicit flag is fresh and
  // authoritative. A missing flag (callback degraded) falls back to the direct
  // authz check; any failure along the way is treated as a denial (fail-closed).
  const flag = (session.user as { isSuperAdmin?: boolean }).isSuperAdmin;
  let dbCheck: boolean | null = null;
  if (flag !== true) {
    try {
      dbCheck = await isSuperAdmin(session.user.id);
    } catch {
      dbCheck = false;
    }
  }
  const superAdmin = flag === true || dbCheck === true;

  if (!superAdmin) {
    return NextResponse.json({ error: 'Forbidden: super admin only' }, { status: 403 });
  }

  return null;
}
