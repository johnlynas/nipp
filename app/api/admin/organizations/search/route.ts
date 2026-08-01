/**
 * GET /api/admin/organizations/search
 *
 * Search organizations by name (prefix match, case-insensitive).
 * Requires Super Admin authentication.
 * Results are cached via the L1+L2 hybrid cache layer (30s TTL).
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSuperAdmin } from '@/lib/middleware/auth';
import tenantDb from '@/lib/tenant-db';
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
// GET — Search organizations by name (prefix match)
// ---------------------------------------------------------------------------

export const GET = withSuperAdmin(async (request, context) => {
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

    // Build cache key from normalized query
    const cacheKey = `search:org:${q}`;

    // Check L1 → L2 → DB via hybrid cache layer
    const cached = await cacheGet<{ results: Array<{ id: string; name: string; slug: string | null }>; total: number }>(
      cacheKey,
      async () => {
        const [results, total] = await Promise.all([
          tenantDb.organization.findMany({
            where: {
              name: { startsWith: q, mode: 'insensitive' },
            },
            select: { id: true, name: true, slug: true },
            orderBy: { name: 'asc' },
            take: limit,
          }),
          tenantDb.organization.count({
            where: {
              name: { startsWith: q, mode: 'insensitive' },
            },
          }),
        ]);

        return { results, total };
      },
      { ttlType: 'search' } // 30-second TTL for search results
    );

    if (cached) {
      logger.debug({ cacheKey, total: cached.total }, 'Organization search cache hit');
      return NextResponse.json(cached);
    }

    logger.warn({ cacheKey }, 'Organization search returned null from cacheGet');
    return NextResponse.json({ results: [], total: 0 });

  } catch (error) {
    logger.error(
      { err: error, route: '/api/admin/organizations/search', method: 'GET' },
      'Unexpected error in organization search'
    );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
