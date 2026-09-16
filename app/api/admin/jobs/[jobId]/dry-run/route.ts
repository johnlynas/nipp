/**
 * POST /api/admin/jobs/[jobId]/dry-run
 *
 * Super Admin (platform-org) only. Executes operator-authored code in the
 * sandbox with dryRun=true: capabilities become no-op recorders, nothing is
 * committed or emitted for real. Rate-limited alongside other admin writes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { JobSchedulerService } from '@/services/job-scheduler-service';
import { ServiceContext } from '@/lib/services/types';
import { logger } from '@/lib/logger';
import { wrapPiiRoute, PiiRouteParams } from '@/lib/payload-middleware';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ---------------------------------------------------------------------------
// POST — Dry-run a job (sandboxed execution, no side effects)
// ---------------------------------------------------------------------------

export const POST = wrapPiiRoute(async (request, decryptedBody, params?) => {
  try {
    logger.info({ route: '/api/admin/jobs/[jobId]/dry-run', method: 'POST' }, 'Request received');

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

    // Optional free-form input the operator attaches to this dry-run.
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
    const result = await JobSchedulerService.dryRunJob(ctx, jobId, input);

    logger.info({ userId: session.user.id, jobId, status: result.status }, '[Jobs API] Job dry-run completed');

    return NextResponse.json({ result }, { status: 202 });
     } catch (error) {
    if (error instanceof Error && error.name === 'NotFoundError') {
      return NextResponse.json({ error: error.message }, { status: 404 });
      }
    if (error instanceof Error && error.name === 'ValidationError') {
      return NextResponse.json({ error: error.message }, { status: 400 });
      }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: error.message }, { status: 403 });
      }
    const isDbError = error instanceof Error && error.message.includes("Can't reach database server");
    logger.error({ err: error, route: '/api/admin/jobs/[jobId]/dry-run', method: 'POST' }, isDbError ? '[Jobs API] Database unavailable' : '[Jobs API] Unexpected error');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal server error' }, { status: isDbError ? 503 : 500 });
    }
});
