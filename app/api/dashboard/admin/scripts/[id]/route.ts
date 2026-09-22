import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

import { JobSchedulerService } from '@/services/job-scheduler-service';
import { NotificationPriority, NotificationScope } from '@prisma/client';
import { withPlatformContext } from '@/lib/platform-db';

export const runtime = 'nodejs';

/**
 * GET /api/dashboard/admin/scripts/[id]
 * Get a single job definition by ID.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const id = (await params).id;
    // One verified platform context for the job + execution-history reads.
    const { job, history } = await withPlatformContext(auth.session!.user.id, async () => ({
      job: await JobSchedulerService.getJob(
        { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' },
        id
      ),
      history: await JobSchedulerService.getExecutionHistory(
        { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' },
        { jobId: id, limit: 50 }
      ),
    }));

    return NextResponse.json({ job, executions: history });
  } catch (error) {
    if (error instanceof Error && error.message === 'Job not found in platform org') {
      return NextResponse.json({ error: 'Script not found' }, { status: 404 });
    }
    console.error('Failed to fetch script:', error);
    return NextResponse.json({ error: 'Failed to fetch script' }, { status: 500 });
  }
}

/**
 * PATCH /api/dashboard/admin/scripts/[id]
 * Update a job definition.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Rate limit write operations by session
  if (!checkAdminRateLimit(auth.session!.user.id)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  let body: {
    name?: string;
    description?: string | null;
    handlerKey?: string;
    scheduleExpr?: string;
    timezone?: string;
    timeoutMs?: number;
    concurrencyLimit?: number;
    enabled?: boolean;
    code?: string | null;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const id = (await params).id;
    // Verified platform context for the job-definition update.
    const result = await withPlatformContext(auth.session!.user.id, () =>
      JobSchedulerService.updateJob(
        { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' },
        id,
        {
          name: body.name,
        description: body.description,
        handlerKey: body.handlerKey,
        scheduleExpr: body.scheduleExpr,
        timezone: body.timezone,
        timeoutMs: body.timeoutMs,
        concurrencyLimit: body.concurrencyLimit,
          enabled: body.enabled,
          code: body.code,
        }
      )
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'Job not found in platform org') {
      return NextResponse.json({ error: 'Script not found' }, { status: 404 });
    }
    if (error instanceof Error && error.message === 'Job is not approved — approve it before enabling') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('Failed to update script:', error);
    const message = error instanceof Error && error.message ? error.message : 'Failed to update script';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/dashboard/admin/scripts/[id]
 * Delete a job definition.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Rate limit write operations by session
  if (!checkAdminRateLimit(auth.session!.user.id)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  try {
    const id = (await params).id;
    // Verified platform context for the job-definition delete.
    await withPlatformContext(auth.session!.user.id, () =>
      JobSchedulerService.disposeJob(
        { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' },
        id
      )
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Job not found in platform org') {
      return NextResponse.json({ error: 'Script not found' }, { status: 404 });
    }
    console.error('Failed to delete script:', error);
    return NextResponse.json({ error: 'Failed to delete script' }, { status: 500 });
  }
}