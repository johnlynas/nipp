import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

import { JobSchedulerService } from '@/services/job-scheduler-service';
import { withPlatformContext } from '@/lib/platform-db';

export const runtime = 'nodejs';

/**
 * POST /api/dashboard/admin/scripts/[id]/trigger
 * Manually trigger a job run.
 */
export async function POST(
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

  let body: { input?: unknown } = {};
  try {
    body = await request.json().catch(() => ({}));
  } catch {
    // Empty body is fine
  }

  try {
    const id = (await params).id;
    // Verified platform context for the triggered run (platform_org_id bound).
    const result = await withPlatformContext(auth.session!.user.id, () =>
      JobSchedulerService.triggerJob(
        { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' },
        id,
        body.input
      )
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'Job not found in platform org') {
      return NextResponse.json({ error: 'Script not found' }, { status: 404 });
    }
    if (error instanceof Error && error.message === 'Job is disabled — enable it before triggering') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('Failed to trigger script:', error);
    const message = error instanceof Error && error.message ? error.message : 'Failed to trigger script';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}