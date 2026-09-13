import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

import globalDb from '@/lib/global-db';
import { JobSchedulerService, type Schedule } from '@/services/job-scheduler-service';
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
    const enabled = url.searchParams.get('enabled');

    const jobs = await JobSchedulerService.listJobs(
      { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' },
      { enabled: enabled ? enabled === 'true' : undefined }
    );

    return NextResponse.json({ items: jobs });
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
    const result = await JobSchedulerService.createJob(
      { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' },
      {
        name: body.name ?? '',
        handlerKey: body.handlerKey ?? 'script-handler',
        scheduleExpr: body.scheduleExpr ?? JSON.stringify({ kind: 'interval', everyMs: 60000 }),
        timezone: body.timezone,
        timeoutMs: body.timeoutMs,
        concurrencyLimit: body.concurrencyLimit,
        enabled: body.enabled ?? false,
        code: body.code,
      }
    );

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error('Failed to create script:', error);
    const message = error instanceof Error && error.message ? error.message : 'Failed to create script';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}