/**
 * PATCH /api/admin/organizations/[orgId]/members/[memberId]
 * DELETE /api/admin/organizations/[orgId]/members/[memberId]
 *
 * Super Admin only — update or remove a member from any tenant organization.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import globalDb from '@/lib/global-db';
import tenantDb from '@/lib/tenant-db';
import { runWithTenant } from '@/lib/tenant-context';
import { recordAuditLog } from '@/lib/audit-log';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// PATCH — Update a member's role in a tenant organization (super admin)
// ---------------------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; memberId: string }> }
) {
  const authResult = await requireSuperAdmin();
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
  }

  const session = authResult.session!;
  const { orgId, memberId } = await params;

  let body: { role?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { role } = body;
  if (!role) {
    return NextResponse.json({ error: 'Role is required' }, { status: 400 });
  }

  try {
    // Verify target org exists (globalDb)
    const org = await globalDb.organization.findUnique({ where: { id: orgId } });
    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Verify member exists and belongs to this org (globalDb)
    const existingMember = await globalDb.member.findFirst({
      where: { id: memberId, orgId },
      include: { user: { select: { name: true, email: true } } },
    });
    if (!existingMember) {
      return NextResponse.json({ error: 'Member not found in this organization' }, { status: 404 });
    }

    // Update member role within tenant context (tenantDb)
    const updatedMember = await runWithTenant(orgId, async () => {
      return tenantDb.member.update({
        where: { id: memberId },
        data: { role },
        include: { user: { select: { name: true, email: true } } },
      });
    });

    // Audit log (globalDb)
    await recordAuditLog({
      userId: session.user.id,
      userName: session.user.name || undefined,
      action: 'member.role_updated',
      success: true,
      resourceType: 'Organization.Member',
      resourceId: memberId,
      organizationId: orgId,
      metadata: { newRole: role },
    });

    logger.info({ userId: session.user.id, orgId, memberId, role }, 'Updated member role in tenant organization');
    return NextResponse.json({ message: 'Member role updated', member: updatedMember });
  } catch (error) {
    const isDbError = error instanceof Error && error.message.includes('Can\'t reach database server');
    logger.error({ err: error, orgId, memberId }, isDbError ? 'Database unavailable updating member' : 'Unexpected error updating member');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal Server Error' }, { status: isDbError ? 503 : 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE — Remove a member from a tenant organization (super admin)
// ---------------------------------------------------------------------------

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; memberId: string }> }
) {
  const authResult = await requireSuperAdmin();
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
  }

  const session = authResult.session!;
  const { orgId, memberId } = await params;

  try {
    // Verify target org exists (globalDb)
    const org = await globalDb.organization.findUnique({ where: { id: orgId } });
    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Verify member exists and belongs to this org (globalDb)
    const existingMember = await globalDb.member.findFirst({
      where: { id: memberId, orgId },
      include: { user: { select: { name: true, email: true } } },
    });
    if (!existingMember) {
      return NextResponse.json({ error: 'Member not found in this organization' }, { status: 404 });
    }

    // Remove member within tenant context (tenantDb)
    await runWithTenant(orgId, async () => {
      return tenantDb.member.delete({ where: { id: memberId } });
    });

    // Audit log (globalDb)
    await recordAuditLog({
      userId: session.user.id,
      userName: session.user.name || undefined,
      action: 'member.deleted',
      success: true,
      resourceType: 'Organization.Member',
      resourceId: memberId,
      organizationId: orgId,
    });

    logger.info({ userId: session.user.id, orgId, memberId }, 'Removed member from tenant organization');
    return NextResponse.json({ message: 'Member removed successfully' });
  } catch (error) {
    const isDbError = error instanceof Error && error.message.includes('Can\'t reach database server');
    logger.error({ err: error, orgId, memberId }, isDbError ? 'Database unavailable removing member' : 'Unexpected error removing member');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal Server Error' }, { status: isDbError ? 503 : 500 });
  }
}
