/**
 * GET /api/admin/organizations/[orgId]/roles
 * POST /api/admin/organizations/[orgId]/roles
 *
 * Super Admin only — manage roles of any tenant organization.
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import globalDb from '@/lib/global-db';
import tenantDb from '@/lib/tenant-db';
import { runWithTenant } from '@/lib/tenant-context';
import { recordAuditLog } from '@/lib/audit-log';
import { logger } from '@/lib/logger';

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
    // Verify target org exists (globalDb)
    const org = await globalDb.organization.findUnique({ where: { id: orgId } });
    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Fetch roles within tenant context (tenantDb — orgId auto-injected by extension)
    const roles = await runWithTenant(orgId, async () => {
      return tenantDb.role.findMany({
        include: {
          permissions: { include: { permission: true } },
          _count: { select: { memberRoles: true } },
        },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      });
    });

    logger.info({ userId: session.user.id, orgId, count: roles.length }, 'Fetched tenant roles');
    return NextResponse.json({ roles });
  } catch (error) {
    const isDbError = error instanceof Error && error.message.includes('Can\'t reach database server');
    logger.error({ err: error, orgId }, isDbError ? 'Database unavailable fetching roles' : 'Unexpected error fetching roles');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal Server Error' }, { status: isDbError ? 503 : 500 });
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
  const { orgId } = await params;

  let body: { name?: string; description?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { name, description } = body;
  if (!name) {
    return NextResponse.json({ error: 'Role name is required' }, { status: 400 });
  }

  try {
    // Verify target org exists (globalDb)
    const org = await globalDb.organization.findUnique({ where: { id: orgId } });
    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Check for duplicate name (globalDb)
    const existingRole = await globalDb.role.findFirst({ where: { name, organizationId: orgId } });
    if (existingRole) {
      return NextResponse.json({ error: 'A role with this name already exists in this organization' }, { status: 409 });
    }

    // Create role within tenant context (tenantDb)
    const role = await runWithTenant(orgId, async () => {
      return tenantDb.role.create({
        data: { name, description: description || '', organizationId: orgId, isDefault: false },
      });
    });

    // Audit log (globalDb)
    await recordAuditLog({
      userId: session.user.id,
      userName: session.user.name || undefined,
      action: 'role.created',
      success: true,
      resourceType: 'Organization.Role',
      resourceId: role.id,
      organizationId: orgId,
    });

    // Invalidate cache
    revalidateTag('org');

    logger.info({ userId: session.user.id, orgId, roleId: role.id }, 'Created role in tenant organization');
    return NextResponse.json({ message: 'Role created successfully', role }, { status: 201 });
  } catch (error) {
    const isDbError = error instanceof Error && error.message.includes('Can\'t reach database server');
    logger.error({ err: error, orgId }, isDbError ? 'Database unavailable creating role' : 'Unexpected error creating role');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal Server Error' }, { status: isDbError ? 503 : 500 });
  }
}
