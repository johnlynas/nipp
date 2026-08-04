/**
 * GET /api/admin/payload-encryption/metrics
 *
 * Returns current payload encryption metrics for observability.
 * Requires Super Admin authentication.
 */

import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { getMetricsSnapshot, resetMetrics } from '@/lib/payload-metrics';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const reset = url.searchParams.get('reset') === 'true';

  if (reset) {
    resetMetrics();
  }

  const metrics = getMetricsSnapshot();

  return NextResponse.json(metrics, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
