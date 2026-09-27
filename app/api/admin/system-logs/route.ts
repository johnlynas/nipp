/**
 * GET /api/admin/system-logs
 * System log access endpoint for super admins. Placeholder — the log source
 * is not yet wired (returns an empty list).
 */

import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { wrapPiiRoute } from '@/lib/payload-middleware';

// PII data — do not cache
export const revalidate = 0;
export const dynamic = 'force-dynamic';

export const GET = wrapPiiRoute(async (request) => {
  try {
    const authResult = await requireSuperAdmin(request.headers);
    
    if (!authResult.authorized || !authResult.session) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
    }

    logger.info({ userId: authResult.session.user.id }, 'System logs accessed by super admin');
    
    // TODO: Fetch and return actual system logs
    return NextResponse.json({ logs: [] });
  } catch (error) {
    logger.error({ err: error }, 'Unexpected error in system-logs GET');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
