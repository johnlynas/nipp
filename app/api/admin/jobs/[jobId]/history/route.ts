/**
 * GET /api/admin/jobs/[jobId]/history
 *
 * Super Admin (platform-org) only — execution history for a single job via
 * JobSchedulerService, most-recent first. Query params:
 *   - limit  — 1..500 (default 50)
 *   - status — SUCCEEDED | FAILED | CANCELLED (optional)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { JobSchedulerService } from '@/services/job-scheduler-service';
import { ServiceContext } from '@/lib/services/types';
// RLS Phase 3: super-admin job ops run under a verified platform context.
import { withPlatformContext } from '@/lib/platform-db';
import { logger } from '@/lib/logger';
import { wrapPiiRoute, PiiRouteParams } from '@/lib/payload-middleware';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ---------------------------------------------------------------------------
// GET — Execution history for one job
// ---------------------------------------------------------------------------

export const GET = wrapPiiRoute(async (request, _decryptedBody, params?: PiiRouteParams) => {
  try {
    logger.info({ route: '/api/admin/jobs/[jobId]/history', method: 'GET' }, 'Request received');

    const authResult = await requireSuperAdmin(request.headers);
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
      }

    const session = authResult.session!;

    const jobId = params?.jobId;
    if (!jobId) {
      return NextResponse.json({ error: 'Job ID is required' }, { status: 400 });
      }

    const url = new URL(request.url);
    const limitParam = url.searchParams.get('limit');
    const statusParam = url.searchParams.get('status');

    const opts: { limit?: number; status?: string } = {};
    if (limitParam) {
      const n = parseInt(limitParam, 10);
      if (Number.isFinite(n) && n >= 1) opts.limit = n;
    }
    if (statusParam === 'SUCCEEDED' || statusParam === 'FAILED' || statusParam === 'CANCELLED') {
      opts.status = statusParam;
    }

    const ctx: ServiceContext = { userId: session.user.id, role: 'PLATFORM_ADMIN' };
    // Verified platform context for the execution-history read.
    const executions = await withPlatformContext(session.user.id, () =>
      JobSchedulerService.getExecutionHistory(ctx, { jobId, ...opts })
    );

    return NextResponse.json(
      { executions },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } },
    );
    } catch (error) {
    if (error instanceof Error && error.name === 'NotFoundError') {
      return NextResponse.json({ error: error.message }, { status: 404 });
      }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: error.message }, { status: 403 });
      }
    const isDbError = error instanceof Error && error.message.includes("Can't reach database server");
    logger.error({ err: error, route: '/api/admin/jobs/[jobId]/history', method: 'GET' }, isDbError ? '[Jobs API] Database unavailable' : '[Jobs API] Unexpected error');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal server error' }, { status: isDbError ? 503 : 500 });
    }
});
