import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

import { JobSchedulerService } from '@/services/job-scheduler-service';

export const runtime = 'nodejs';

/**
 * POST /api/dashboard/admin/scripts/[id]/dry-run
 * Dry-run a job script without committing results.
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
    const result = await JobSchedulerService.dryRunJob(
      { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' },
      id,
      body.input
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'Job not found in platform org') {
      return NextResponse.json({ error: 'Script not found' }, { status: 404 });
    }
    console.error('Failed to dry-run script:', error);
    const message = error instanceof Error && error.message ? error.message : 'Failed to dry-run script';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}