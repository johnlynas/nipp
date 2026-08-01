/**
 * GET /api/roles/search
 *
 * Search roles by name (prefix match, case-insensitive) within a specific organization.
 * Requires session authentication + `roles:view` permission in the target organization.
 * Results are cached via the L1+L2 hybrid cache layer (30s TTL).
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import tenantDb from '@/lib/tenant-db';
import { cacheGet } from '@/lib/cache/hybrid';
import { resolvePermissions } from '@/lib/permissions/resolver';
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
// GET — Search roles by name (prefix match, org-scoped)
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const qRaw = url.searchParams.get('q');
    const organizationId = url.searchParams.get('organizationId');
    const limitRaw = url.searchParams.get('limit');

    // Validate query parameter
    if (!qRaw || qRaw.trim().length === 0) {
      return NextResponse.json(
        { error: 'Query parameter "q" is required' },
        { status: 400 }
      );
    }

    // Validate organizationId parameter
    if (!organizationId) {
      return NextResponse.json(
        { error: 'Query parameter "organizationId" is required' },
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

    // Authenticate: validate session
    const session = await auth.api.getSession({ headers: req.headers });

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Authorize: check `roles:view` permission in the target organization
    const userPermissions = await resolvePermissions(session.user.id, organizationId);

    if (!userPermissions.includes('roles:view')) {
      return NextResponse.json(
        { error: 'Forbidden: insufficient permissions' },
        { status: 403 }
      );
    }

    // Build cache key from orgId + normalized query (includes org context)
    const cacheKey = `search:role:${organizationId}:${q}`;

    // Check L1 → L2 → DB via hybrid cache layer
    const cached = await cacheGet<{ results: Array<{ id: string; name: string; description: string | null }>; total: number }>(
      cacheKey,
      async () => {
        // Execute prefix search scoped to organization (case-insensitive)
        const [results, total] = await Promise.all([
          tenantDb.role.findMany({
            where: {
              organizationId,
              name: { startsWith: q, mode: 'insensitive' },
            },
            select: { id: true, name: true, description: true },
            orderBy: { name: 'asc' },
            take: limit,
          }),
          tenantDb.role.count({
            where: {
              organizationId,
              name: { startsWith: q, mode: 'insensitive' },
            },
          }),
        ]);

        return { results, total };
      },
      { ttlType: 'search' } // 30-second TTL for search results
    );

    if (cached) {
      logger.debug({ cacheKey, total: cached.total }, 'Role search cache hit');
      return NextResponse.json(cached);
    }

    logger.warn({ cacheKey }, 'Role search returned null from cacheGet');
    return NextResponse.json({ results: [], total: 0 });

  } catch (error) {
    logger.error(
      { err: error, route: '/api/roles/search', method: 'GET' },
      'Unexpected error in role search'
    );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
