/**
 * GET /api/admin/payload-encryption/metrics
 *
 * Returns current payload encryption metrics for observability.
 * Requires Super Admin authentication; rate-limited per session.
 */

import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';
import { getMetricsSnapshot, resetMetrics } from '@/lib/payload-metrics';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  const authResult = await requireSuperAdmin(request.headers);
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
  }

  // Rate limit admin operations by session (matches the sibling /api/admin routes).
  if (!checkAdminRateLimit(authResult.session!.user.id)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

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
