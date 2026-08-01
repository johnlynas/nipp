/**
 * GET /api/cache/metrics
 *
 * Returns detailed cache metrics for the admin dashboard.
 * Includes L1 hit/miss rates, entry counts, memory usage, and Redis status.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSuperAdmin } from '@/lib/middleware/auth';
import { getCacheMetrics } from '@/lib/cache/health';
import { getLruCache } from '@/lib/cache/lru';

export const GET = withSuperAdmin(async (request, context) => {
  try {
    const metrics = getCacheMetrics();
    const lru = getLruCache();

    // Get additional L1 cache details
    const l1Details = {
      enabled: lru !== null,
      maxSize: lru?.max ?? 0,
      maxEntrySize: lru?.maxEntrySize ?? 0,
    };

    return NextResponse.json({
      success: true,
      data: {
        metrics,
        l1Details,
        timestamp: new Date().toISOString(),
      },
    });

  } catch (error) {
    console.error('[Cache Metrics API] Failed to fetch metrics:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch cache metrics' },
      { status: 500 }
    );
  }
});
