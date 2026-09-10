/**
 * GET /api/admin/jobs
 * POST /api/admin/jobs
 *
 * Super Admin (platform-org) only — list and create background jobs via
 * JobSchedulerService. This is the approval-gate entry point: a newly created
 * job starts enabled=false / approved=false and must be approved before it can
 * run. Tenant users have no access (requireSuperAdmin fails closed).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { JobSchedulerService, CreateJobInput } from '@/services/job-scheduler-service';
import { ServiceContext } from '@/lib/services/types';
import { logger } from '@/lib/logger';
import { wrapPiiRoute } from '@/lib/payload-middleware';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Map a service-layer typed error to an HTTP response, else 500/503. */
async function errorResponse(
  error: unknown,
  route: string,
  method: string,
): Promise<NextResponse> {
  if (error instanceof Error && error.name === 'ValidationError') {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof Error && error.name === 'ConflictError') {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof Error && error.name === 'ForbiddenError') {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof Error && error.name === 'NotFoundError') {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  const isDbError = error instanceof Error && error.message.includes("Can't reach database server");
  logger.error(
    { err: error, route, method },
    isDbError ? '[Jobs API] Database unavailable' : '[Jobs API] Unexpected error',
  );
  return NextResponse.json(
    { error: isDbError ? 'Database unavailable' : 'Internal server error' },
    { status: isDbError ? 503 : 500 },
  );
}

// ---------------------------------------------------------------------------
// GET — List jobs for the platform org
// ---------------------------------------------------------------------------

export const GET = wrapPiiRoute(async (request, _decryptedBody) => {
  try {
    logger.info({ route: '/api/admin/jobs', method: 'GET' }, 'Request received');

    const authResult = await requireSuperAdmin(request.headers);
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
     }

    const session = authResult.session!;
    const ctx: ServiceContext = { userId: session.user.id, role: 'PLATFORM_ADMIN' };

    const url = new URL(request.url);
    const enabledParam = url.searchParams.get('enabled');
    const approvedParam = url.searchParams.get('approved');
    const limitParam = url.searchParams.get('limit');

    const opts: { enabled?: boolean; approved?: boolean; limit?: number } = {};
    if (enabledParam === 'true' || enabledParam === 'false') opts.enabled = enabledParam === 'true';
    if (approvedParam === 'true' || approvedParam === 'false') opts.approved = approvedParam === 'true';
    if (limitParam) opts.limit = parseInt(limitParam, 10);

    const jobs = await JobSchedulerService.listJobs(ctx, opts);

    return NextResponse.json({ jobs }, { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } });
   } catch (error) {
    return errorResponse(error, '/api/admin/jobs', 'GET');
   }
});

// ---------------------------------------------------------------------------
// POST — Create a job (starts unapproved + disabled)
// ---------------------------------------------------------------------------

export const POST = wrapPiiRoute(async (request, decryptedBody) => {
  try {
    logger.info({ route: '/api/admin/jobs', method: 'POST' }, 'Request received');

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

     // Parse body from decrypted payload or raw JSON
    let body: CreateJobInput;
    if (decryptedBody && typeof decryptedBody === 'object') {
      body = decryptedBody as CreateJobInput;
     } else {
      const contentType = request.headers.get('Content-Type') || '';
      if (contentType.includes('application/octet-stream')) {
        return NextResponse.json(
           { error: 'Payload encryption is enabled on the client but disabled on the server. Set PAYLOAD_ENCRYPTION_MODE=permissive or enforce.' },
           { status: 400 },
          );
        }
      try {
        body = await request.json();
        } catch {
          return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
          }
        }

    if (!body.name || !body.handlerKey || !body.scheduleExpr) {
      return NextResponse.json(
        { error: 'name, handlerKey and scheduleExpr are required' },
        { status: 400 },
      );
     }

    const ctx: ServiceContext = { userId: session.user.id, role: 'PLATFORM_ADMIN' };

    const job = await JobSchedulerService.createJob(ctx, {
      name: body.name,
      handlerKey: body.handlerKey,
      scheduleExpr: body.scheduleExpr,
      timezone: body.timezone,
      timeoutMs: body.timeoutMs,
      concurrencyLimit: body.concurrencyLimit,
      enabled: body.enabled ?? false,
      code: body.code ?? null,
       });

    logger.info({ userId: session.user.id, jobId: job.id }, '[Jobs API] Job created (unapproved)');

    return NextResponse.json({ job }, { status: 201 });
    } catch (error) {
    return errorResponse(error, '/api/admin/jobs', 'POST');
    }
});
