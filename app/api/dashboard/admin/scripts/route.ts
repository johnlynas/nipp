import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

import { JobSchedulerService, type Schedule } from '@/services/job-scheduler-service';
import { withPlatformContext } from '@/lib/platform-db';
import { NotificationPriority, NotificationScope } from '@prisma/client';

export const runtime = 'nodejs';

/**
 * GET /api/dashboard/admin/scripts
 * List all job definitions (custom scripts) for the platform organization.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const pageSize = parseInt(url.searchParams.get('pageSize') || '8', 10);
    const enabled = url.searchParams.get('enabled');
    const approved = url.searchParams.get('approved');
    const lastRunStatus = url.searchParams.get('lastRunStatus');
    const search = url.searchParams.get('search');

    // One verified platform context for the job catalog (platform_org_id bound).
    const result = await withPlatformContext(auth.session!.user.id, () =>
      JobSchedulerService.listJobsPaginated(
        { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' },
        {
          page: Number.isNaN(page) ? 1 : page,
          pageSize: Number.isNaN(pageSize) ? 8 : pageSize,
          enabled: enabled ? enabled === 'true' : undefined,
          approved: approved ? approved === 'true' : undefined,
          lastRunStatus: lastRunStatus || undefined,
          search: search || undefined,
        }
      )
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to list scripts:', error);
    return NextResponse.json({ error: 'Failed to fetch scripts' }, { status: 500 });
  }
}

/**
 * POST /api/dashboard/admin/scripts
 * Create a new job definition (custom script).
 */
export async function POST(request: NextRequest) {
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

  const targetLabel = body.name || 'unnamed script';

  try {
    // Verified platform context for the job-definition insert.
    const result = await withPlatformContext(auth.session!.user.id, () =>
      JobSchedulerService.createJob(
        { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' },
      {
        name: body.name ?? '',
        description: body.description,
        handlerKey: body.handlerKey ?? 'script-handler',
        scheduleExpr: body.scheduleExpr ?? JSON.stringify({ kind: 'interval', everyMs: 60000 }),
        timezone: body.timezone,
        timeoutMs: body.timeoutMs,
        concurrencyLimit: body.concurrencyLimit,
        enabled: body.enabled ?? false,
          code: body.code,
        }
      )
    );

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error('Failed to create script:', error);
    const message = error instanceof Error && error.message ? error.message : 'Failed to create script';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}