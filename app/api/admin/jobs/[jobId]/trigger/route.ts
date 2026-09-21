/**
 * POST /api/admin/jobs/[jobId]/trigger
 *
 * Super Admin (platform-org) only, highest-risk action — execute a job now.
 * Requires the job to be enabled AND approved. The manual trigger bypasses the
 * idempotency claim gate (an explicit override intent).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { JobSchedulerService } from '@/services/job-scheduler-service';
import { ServiceContext } from '@/lib/services/types';
// RLS Phase 3: super-admin job ops run under a verified platform context.
import { withPlatformContext } from '@/lib/platform-db';
import { logger } from '@/lib/logger';
import { wrapPiiRoute, PiiRouteParams } from '@/lib/payload-middleware';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ---------------------------------------------------------------------------
// POST — Trigger a job now (manual run, audit-tracked)
// ---------------------------------------------------------------------------

export const POST = wrapPiiRoute(async (request, decryptedBody, params?) => {
  try {
    logger.info({ route: '/api/admin/jobs/[jobId]/trigger', method: 'POST' }, 'Request received');

    const authResult = await requireSuperAdmin(request.headers);
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
      }

    const session = authResult.session!;

     // Rate limit admin write operations by session
    if (!checkAdminRateLimit(session.user.id)) {
      logger.warn({ userId: session.user.id }, 'Admin write rate limited');
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
      }

    const jobId = params?.jobId;
    if (!jobId) {
      return NextResponse.json({ error: 'Job ID is required' }, { status: 400 });
      }

      // Optional free-form input the operator attaches to this run.
    let input: unknown;
    if (decryptedBody && typeof decryptedBody === 'object') {
      input = decryptedBody;
      } else {
      try {
        const raw = await request.json();
        input = raw;
         } catch {
          input = undefined;
           }
         }

    const ctx: ServiceContext = { userId: session.user.id, role: 'PLATFORM_ADMIN' };
    // Verified platform context for the manual run (platform_org_id bound).
    const result = await withPlatformContext(session.user.id, () => JobSchedulerService.triggerJob(ctx, jobId, input));

    logger.info({ userId: session.user.id, jobId, status: result.status }, '[Jobs API] Job triggered');

    return NextResponse.json({ result }, { status: 202 });
     } catch (error) {
    if (error instanceof Error && error.name === 'NotFoundError') {
      return NextResponse.json({ error: error.message }, { status: 404 });
      }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: error.message }, { status: 403 });
      }
    const isDbError = error instanceof Error && error.message.includes("Can't reach database server");
    logger.error({ err: error, route: '/api/admin/jobs/[jobId]/trigger', method: 'POST' }, isDbError ? '[Jobs API] Database unavailable' : '[Jobs API] Unexpected error');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal server error' }, { status: isDbError ? 503 : 500 });
    }
});
