/**
 * GET /api/admin/organizations/[orgId]/roles
 * POST /api/admin/organizations/[orgId]/roles
 *
 * Super Admin only — manage roles of any tenant organization.
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { requireSuperAdmin } from '@/lib/require-super-admin';
// RLS Phase 3: tenant-role management runs under a verified target-org context.
import tenantDb from '@/lib/tenant-db';
import { withTenantAdminContext } from '@/lib/platform-db';
import { RoleService } from '@/services/role-service';
import { handleServiceError } from '@/lib/services/error-handler';
import type { ServiceContext } from '@/lib/services/types';
import { logger } from '@/lib/logger';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

export const runtime = 'nodejs';
export const revalidate = 30;

// ---------------------------------------------------------------------------
// GET — List all roles in a tenant organization (super admin)
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const authResult = await requireSuperAdmin();
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
  }

  const session = authResult.session!;
  const { orgId } = await params;

  try {
    // RLS: verified target-org context for both org check and role listing
    return await withTenantAdminContext(session.user.id, orgId, async () => {
      // Verify target org exists (flag admits any org row)
      const org = await tenantDb.organization.findUnique({ where: { id: orgId } });
      if (!org) {
        return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
      }

      // Construct service context — Platform Admin acting on target org
      const ctx: ServiceContext = {
        userId: session.user.id,
        role: 'PLATFORM_ADMIN',
      };

      const result = await RoleService.list(orgId, {}, { page: 1, pageSize: 100 }, ctx);

      logger.info({ userId: session.user.id, orgId, count: result.items.length }, 'Fetched tenant roles');
      return NextResponse.json({ roles: result.items });
    });
  } catch (error) {
    return handleDbOrServiceError(error);
  }
}

// ---------------------------------------------------------------------------
// POST — Create a role in a tenant organization (super admin)
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const authResult = await requireSuperAdmin();
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
  }

  const session = authResult.session!;

  // Rate limit admin write operations by session
  if (!checkAdminRateLimit(session.user.id)) {
    logger.warn({ userId: session.user.id }, 'Admin write rate limited');
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const { orgId } = await params;

  let body: { name?: string; description?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!body.name) {
    return NextResponse.json({ error: 'Role name is required' }, { status: 400 });
  }

  // Capture narrowed values (const) so the async closure below keeps their types.
  const roleData = { name: body.name, description: body.description };

  try {
    // RLS: verified target-org context for org check + role create (RLS WITH CHECK binds write to ctx org)
    return await withTenantAdminContext(session.user.id, orgId, async () => {
      // Verify target org exists
      const org = await tenantDb.organization.findUnique({ where: { id: orgId } });
      if (!org) {
        return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
      }

      // Construct service context — Platform Admin acting on target org
      const ctx: ServiceContext = {
        userId: session.user.id,
        role: 'PLATFORM_ADMIN',
      };

      const role = await RoleService.create(roleData, orgId, ctx);

      // Audit log
      await recordAuditLog({
        userId: session.user.id,
        userName: session.user.name ?? null,
        action: 'role.created',
        success: true,
        resourceType: 'Organization.Role' as string,
        resourceId: role.id ?? null,
        organizationId: orgId,
      } as never);

      // Invalidate cache
      revalidateTag('org', { expire: 0 });

      logger.info({ userId: session.user.id, orgId, roleId: role.id }, 'Created role in tenant organization');
      return NextResponse.json({ message: 'Role created successfully', role }, { status: 201 });
    });
  } catch (error) {
    return handleDbOrServiceError(error);
  }
}

// ---------------------------------------------------------------------------
// Audit log helper (inline to avoid circular dependency)
// ---------------------------------------------------------------------------

/**
 * Handle both database errors (503) and service-layer errors.
 */
function handleDbOrServiceError(error: unknown): ReturnType<typeof NextResponse.json> {
  const isDbError = error instanceof Error && error.message.includes("Can't reach database server");
  if (isDbError) {
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
  }
  return handleServiceError(error);
}

async function recordAuditLog(params: {
  userId: string;
  userName?: string | null;
  action: string;
  success: boolean;
  resourceType?: string | null;
  resourceId?: string | null;
  organizationId?: string | null;
}): Promise<void> {
  const { recordAuditLog: rl } = await import('@/lib/audit-log');
  return rl(params as never);
}
