/**
 * GET /api/admin/permissions/search
 *
 * Search permissions by key (prefix match, case-insensitive).
 * Requires Super Admin authentication.
 * Results are cached via the L1+L2 hybrid cache layer (30s TTL).
 */

import { NextRequest, NextResponse } from 'next/server';
import globalDb from '@/lib/global-db';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';
import { cacheGet } from '@/lib/cache/hybrid';
import { logger } from '@/lib/logger';

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
// GET — Search permissions by key (prefix match)
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
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

    // Authenticate: require Super Admin
    const authResult = await requireSuperAdmin(request.headers);
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
    }

    // Rate limit admin operations by session (safe extraction for tests)
    const userId = authResult.session?.user?.id;
    if (userId && !checkAdminRateLimit(userId)) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }

    // Build cache key from normalized query
    const cacheKey = `search:perm:${q}`;

    // Check L1 → L2 → DB via hybrid cache layer
    const cached = await cacheGet<{ results: Array<{ id: string; key: string; resource: string; action: string; description: string | null }>; total: number }>(
      cacheKey,
      async () => {
        // Execute prefix search on permission key (case-insensitive)
        const [results, total] = await Promise.all([
          globalDb.permission.findMany({
            where: {
              key: { startsWith: q, mode: 'insensitive' },
            },
            select: { id: true, key: true, resource: true, action: true, description: true },
            orderBy: { key: 'asc' },
            take: limit,
          }),
          globalDb.permission.count({
            where: {
              key: { startsWith: q, mode: 'insensitive' },
            },
          }),
        ]);

        return { results, total };
      },
      { ttlType: 'search' } // 30-second TTL for search results
    );

    if (cached) {
      logger.debug({ cacheKey, total: cached.total }, 'Permission search cache hit');
      return NextResponse.json(cached);
    }

    logger.warn({ cacheKey }, 'Permission search returned null from cacheGet');
    return NextResponse.json({ results: [], total: 0 });

  } catch (error) {
    logger.error(
      { err: error, route: '/api/admin/permissions/search', method: 'GET' },
      'Unexpected error in permission search'
    );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
