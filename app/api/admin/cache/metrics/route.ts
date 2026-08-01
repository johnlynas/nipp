/**
 * GET /api/admin/cache/metrics
 *
 * Exposes L1 (in-memory) and L2 (Redis) cache performance metrics.
 * Requires Super Admin authentication.
 *
 * Returns:
 * - L1 hit/miss counts and hit rate percentage
 * - L2 (Redis) hit/miss counts and hit rate percentage
 * - L1 cache size (entries) and memory usage (bytes)
 * - Redis connection state
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSuperAdmin } from '@/lib/middleware/auth';
import { getCacheMetrics, resetMetrics } from '@/lib/cache/health';
import { resetL1Counters } from '@/lib/cache/metrics';
import { logger } from '@/lib/logger';

// ---------------------------------------------------------------------------
// GET — Cache metrics dashboard data
// ---------------------------------------------------------------------------

export const GET = withSuperAdmin(async (request, context) => {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    // Allow resetting metrics via ?action=reset
    if (action === 'reset') {
      resetMetrics();
      resetL1Counters();
      logger.info({ userId: context.user.id }, 'Cache metrics counters reset');
    }

    const metrics = getCacheMetrics();

    // Compute L2 hit rate
    const l2Total = metrics.l2Hits + metrics.l2Misses;
    const l2HitRate = l2Total > 0 ? (metrics.l2Hits / l2Total) * 100 : 0;

    return NextResponse.json({
      l1: {
        hits: metrics.l1Hits,
        misses: metrics.l1Misses,
        hitRate: metrics.l1HitRate,
        size: metrics.l1Size,
        memoryBytes: metrics.l1MemoryBytes,
        memoryMB: Math.round((metrics.l1MemoryBytes / 1024 / 1024) * 100) / 100,
      },
      l2: {
        hits: metrics.l2Hits,
        misses: metrics.l2Misses,
        hitRate: l2HitRate,
      },
      redisConnected: metrics.redisConnected,
    });

  } catch (error) {
    logger.error(
      { err: error, route: '/api/admin/cache/metrics', method: 'GET' },
      'Unexpected error in cache metrics endpoint'
    );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
