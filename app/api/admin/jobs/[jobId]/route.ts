/**
 * GET /api/admin/jobs/[jobId]
 * PATCH /api/admin/jobs/[jobId]
 * DELETE /api/admin/jobs/[jobId]
 *
 * Super Admin (platform-org) only — read, update, and delete a single job via
 * JobSchedulerService. Enabling a job through PATCH is gated on prior approval
 * (the service enforces this). DELETE removes the job definition (its
 * execution history cascades) and is audit-logged.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { JobSchedulerService, UpdateJobInput } from '@/services/job-scheduler-service';
// RLS Phase 3: super-admin job ops run under a verified platform context.
import { withPlatformContext } from '@/lib/platform-db';
import { ServiceContext } from '@/lib/services/types';
import { logger } from '@/lib/logger';
import { wrapPiiRoute, PiiRouteParams } from '@/lib/payload-middleware';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ---------------------------------------------------------------------------
// GET — Read a single job
// ---------------------------------------------------------------------------

export const GET = wrapPiiRoute(async (request, _decryptedBody, params?) => {
  try {
    logger.info({ route: '/api/admin/jobs/[jobId]', method: 'GET' }, 'Request received');

    const authResult = await requireSuperAdmin(request.headers);
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
      }

    const session = authResult.session!;
    const jobId = params?.jobId;
    if (!jobId) {
      return NextResponse.json({ error: 'Job ID is required' }, { status: 400 });
      }

    const ctx: ServiceContext = { userId: session.user.id, role: 'PLATFORM_ADMIN' };
    // Verified platform context for the job read.
    const job = await withPlatformContext(session.user.id, () => JobSchedulerService.getJob(ctx, jobId));

    return NextResponse.json({ job }, { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } });
    } catch (error) {
    if (error instanceof Error && error.name === 'NotFoundError') {
      return NextResponse.json({ error: error.message }, { status: 404 });
      }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: error.message }, { status: 403 });
      }
    const isDbError = error instanceof Error && error.message.includes("Can't reach database server");
    logger.error({ err: error, route: '/api/admin/jobs/[jobId]', method: 'GET' }, isDbError ? '[Jobs API] Database unavailable' : '[Jobs API] Unexpected error');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal server error' }, { status: isDbError ? 503 : 500 });
    }
});

// ---------------------------------------------------------------------------
// PATCH — Update a job (schedule, timeout, enabled flag, code, …)
// ---------------------------------------------------------------------------

export const PATCH = wrapPiiRoute(async (request, decryptedBody, params?) => {
  try {
    logger.info({ route: '/api/admin/jobs/[jobId]', method: 'PATCH' }, 'Request received');

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

       // Parse body from decrypted payload or raw JSON
    let body: UpdateJobInput;
    if (decryptedBody && typeof decryptedBody === 'object') {
      body = decryptedBody as UpdateJobInput;
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

    const ctx: ServiceContext = { userId: session.user.id, role: 'PLATFORM_ADMIN' };
    // Verified platform context for the job update.
    const job = await withPlatformContext(session.user.id, () => JobSchedulerService.updateJob(ctx, jobId, body));

    logger.info({ userId: session.user.id, jobId }, '[Jobs API] Job updated');

    return NextResponse.json({ job });
     } catch (error) {
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
    logger.error({ err: error, route: '/api/admin/jobs/[jobId]', method: 'PATCH' }, isDbError ? '[Jobs API] Database unavailable' : '[Jobs API] Unexpected error');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal server error' }, { status: isDbError ? 503 : 500 });
    }
});

// ---------------------------------------------------------------------------
// DELETE — Remove a job definition (execution history cascades)
// ---------------------------------------------------------------------------

export const DELETE = wrapPiiRoute(async (request, _decryptedBody, params?) => {
  try {
    logger.info({ route: '/api/admin/jobs/[jobId]', method: 'DELETE' }, 'Request received');

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

    const ctx: ServiceContext = { userId: session.user.id, role: 'PLATFORM_ADMIN' };
    // Verified platform context for the job delete.
    const result = await withPlatformContext(session.user.id, () => JobSchedulerService.disposeJob(ctx, jobId));

    logger.info({ userId: session.user.id, jobId }, '[Jobs API] Job deleted');

    return NextResponse.json(result);
    } catch (error) {
    if (error instanceof Error && error.name === 'NotFoundError') {
      return NextResponse.json({ error: error.message }, { status: 404 });
      }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: error.message }, { status: 403 });
      }
    const isDbError = error instanceof Error && error.message.includes("Can't reach database server");
    logger.error({ err: error, route: '/api/admin/jobs/[jobId]', method: 'DELETE' }, isDbError ? '[Jobs API] Database unavailable' : '[Jobs API] Unexpected error');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal server error' }, { status: isDbError ? 503 : 500 });
    }
});
