/**
 * GET /api/admin/users/search
 *
 * Search users by name or email (prefix match, case-insensitive).
 * Requires Super Admin authentication.
 * Results are cached via the L1+L2 hybrid cache layer (30s TTL).
 *
 * Payload encryption: wrapped with wrapPiiRoute for defense-in-depth.
 */

import { NextRequest, NextResponse } from 'next/server';
import tenantDb from '@/lib/tenant-db';
// RLS Phase 3: super-admin ops run under a verified platform context.
import { withPlatformContext } from '@/lib/platform-db';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';
import { logger } from '@/lib/logger';
import { wrapPiiRoute } from '@/lib/payload-middleware';

// PII data — do not cache at Next.js level
export const revalidate = 0;
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;
const MAX_QUERY_LENGTH = 100;

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// GET — Search users by name or email (prefix match)
// ---------------------------------------------------------------------------

export const GET = wrapPiiRoute(async (request) => {
  // Auth check — wrapPiiRoute handles encryption, not authorization
  const authResult = await requireSuperAdmin(request.headers);
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
  }

  const session = authResult.session!;

    // Rate limit admin operations by session
    if (!checkAdminRateLimit(session.user.id)) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }

  try {
    const url = new URL(request.url);
    const qRaw = url.searchParams.get('q');
    const limitRaw = url.searchParams.get('limit');

    // Validate query parameter
    if (!qRaw || qRaw.trim().length === 0) {
      return NextResponse.json(
        { error: 'Query parameter "q" is required' },
        { status: 400 }
      );
    }

    const q = normalizeQuery(qRaw);

    if (q.length > MAX_QUERY_LENGTH) {
      return NextResponse.json(
        { error: `Query must be at most ${MAX_QUERY_LENGTH} characters` },
        { status: 400 }
      );
    }

    // Parse and validate limit
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(DEFAULT_LIMIT, parseInt(limitRaw || String(DEFAULT_LIMIT), 10))
    );

    // Execute search directly — no plaintext caching for PII results.
    // The wrapPiiRoute encrypts the response, so cached plaintext is unnecessary
    // and would expose PII in server-side cache stores.
    // Verified platform context for the PII user search.
    const [results, total] = await withPlatformContext(session.user.id, () =>
      Promise.all([
        tenantDb.user.findMany({
          where: {
            OR: [
              { name: { startsWith: q, mode: 'insensitive' } },
              { email: { startsWith: q, mode: 'insensitive' } },
            ],
          },
          select: { id: true, name: true, email: true },
          orderBy: { name: 'asc' },
          take: limit,
        }),
        tenantDb.user.count({
          where: {
            OR: [
              { name: { startsWith: q, mode: 'insensitive' } },
              { email: { startsWith: q, mode: 'insensitive' } },
            ],
          },
        }),
      ])
    );

    return NextResponse.json({ results, total });

  } catch (error) {
    const isDbError = error instanceof Error && error.message.includes("Can't reach database server");
    logger.error(
      { err: error, route: '/api/admin/users/search', method: 'GET' },
      isDbError ? 'Database unavailable in user search' : 'Unexpected error in user search'
    );
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal server error' }, { status: isDbError ? 503 : 500 });
  }
});
