/**
 * GET /api/admin/audit-logs
 * Cross-tenant audit trail (most recent first). Supports page, pageSize and
 * resourceType filters. Super admin only; rate-limited per session.
 */

import { NextResponse } from 'next/server';
// RLS Phase 3: cross-tenant audit reads run under the verified platform context.
import tenantDb from '@/lib/tenant-db';
import { withPlatformContext } from '@/lib/platform-db';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';
import { logger } from '@/lib/logger';
import { wrapPiiRoute } from '@/lib/payload-middleware';

// PII data — do not cache
export const revalidate = 0;
export const dynamic = 'force-dynamic';

export const GET = wrapPiiRoute(async (request) => {
  try {
    const authResult = await requireSuperAdmin(request.headers);
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
    }

    const session = authResult.session!;

    // Rate limit admin operations by session
    if (!checkAdminRateLimit(session.user.id)) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const pageSize = parseInt(url.searchParams.get('pageSize') || '50', 10);
    const resourceType = url.searchParams.get('resourceType') || undefined;

    // Build where clause
    const where: Record<string, unknown> = {};
    if (resourceType) {
      where.resourceType = resourceType;
    }

    const [logs, total] = await withPlatformContext(session.user.id, async () =>
      Promise.all([
        tenantDb.auditLog.findMany({
          where,
          orderBy: { timestamp: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            timestamp: true,
            userId: true,
            userName: true,
            action: true,
            resourceType: true,
            resourceId: true,
            organizationId: true,
            success: true,
          },
        }),
        tenantDb.auditLog.count({ where }),
      ]),
    );

    return NextResponse.json({
      auditLogs: logs.map((log) => ({
        id: log.id,
        timestamp: log.timestamp.toISOString(),
        userId: log.userId ?? undefined,
        userName: log.userName ?? undefined,
        action: log.action,
        resourceType: log.resourceType,
        resourceId: log.resourceId ?? undefined,
        organizationId: log.organizationId ?? undefined,
        success: log.success,
      })),
      pagination: { page, pageSize, total },
    });
  } catch (error) {
    logger.error({ err: error }, '[Audit Logs API] Unexpected error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
