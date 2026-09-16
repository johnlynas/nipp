/**
 * POST /api/admin/jobs/[jobId]/approvals
 *
 * Super Admin (platform-org) only. The approval gate is the control that lets a
 * job move from "defined" to "may execute": only an approved job can be enabled
 * or triggered. Body: { action: 'approve' | 'reject', note?: string }. Each
 * decision is audited via JobSchedulerService.
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
// POST — Approve (default) or reject a job
// ---------------------------------------------------------------------------

export const POST = wrapPiiRoute(async (request, decryptedBody, params?: PiiRouteParams) => {
  try {
    logger.info({ route: '/api/admin/jobs/[jobId]/approvals', method: 'POST' }, 'Request received');

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

    // Action: 'approve' (default) or 'reject'. An optional note is recorded.
    let action: 'approve' | 'reject' = 'approve';
    let note: string | undefined;
    if (decryptedBody && typeof decryptedBody === 'object') {
      const b = decryptedBody as Record<string, unknown>;
      if (b.action === 'reject') action = 'reject';
      if (typeof b.note === 'string' && b.note.length > 0) note = b.note;
      } else {
      try {
        const raw = await request.json();
        if (raw?.action === 'reject') action = 'reject';
        if (typeof raw?.note === 'string' && raw.note.length > 0) note = raw.note;
        } catch {
        // No body → default to approve with no note.
        }
      }

    const ctx: ServiceContext = { userId: session.user.id, role: 'PLATFORM_ADMIN' };

    const job =
      action === 'reject'
        ? await JobSchedulerService.rejectJob(ctx, jobId, { note })
        : await JobSchedulerService.approveJob(ctx, jobId, { note });

    logger.info({ userId: session.user.id, jobId, action }, `[Jobs API] Job ${action}d`);

    return NextResponse.json({ job, action });
    } catch (error) {
    if (error instanceof Error && error.name === 'NotFoundError') {
      return NextResponse.json({ error: error.message }, { status: 404 });
      }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: error.message }, { status: 403 });
      }
    const isDbError = error instanceof Error && error.message.includes("Can't reach database server");
    logger.error({ err: error, route: '/api/admin/jobs/[jobId]/approvals', method: 'POST' }, isDbError ? '[Jobs API] Database unavailable' : '[Jobs API] Unexpected error');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal server error' }, { status: isDbError ? 503 : 500 });
    }
});
