/**
 * PATCH /api/admin/organizations/[orgId]/members/[memberId]
 * DELETE /api/admin/organizations/[orgId]/members/[memberId]
 *
 * Super Admin only — update or remove a member from any tenant organization.
 * Wrapped with payload encryption middleware for defense-in-depth.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import globalDb from '@/lib/global-db';
import tenantDb from '@/lib/tenant-db';
import { runWithTenant } from '@/lib/tenant-context';
import { recordAuditLog } from '@/lib/audit-log';
import { logger } from '@/lib/logger';
import { wrapPiiRoute, PiiRouteParams } from '@/lib/payload-middleware';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// PATCH — Update a member's role in a tenant organization (super admin)
// ---------------------------------------------------------------------------

export const PATCH = wrapPiiRoute(async (request, decryptedBody, params) => {
  const authResult = await requireSuperAdmin(request.headers);
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
  }

  const session = authResult.session!;

  // Extract orgId and memberId from route params (provided by wrapPiiRoute)
  const urlOrgId = params?.orgId;
  const urlMemberId = params?.memberId;

  if (!urlOrgId) {
    return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
  }
  if (!urlMemberId) {
    return NextResponse.json({ error: 'Member ID is required' }, { status: 400 });
  }

  // Use decryptedBody (already parsed JSON) or fall back to request.json()
  let body: { role?: string };
  if (decryptedBody && typeof decryptedBody === 'object') {
    body = decryptedBody as { role?: string };
  } else {
    const contentType = request.headers.get('Content-Type') || '';
    if (contentType.includes('application/octet-stream')) {
      return NextResponse.json(
        { error: 'Payload encryption is enabled on the client but disabled on the server. Set PAYLOAD_ENCRYPTION_MODE=permissive or enforce.' },
        { status: 400 },
      );
    }
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
  }

  const { role } = body;
  if (!role) {
    return NextResponse.json({ error: 'Role is required' }, { status: 400 });
  }

  try {
    // Verify target org exists (globalDb)
    const org = await globalDb.organization.findUnique({ where: { id: urlOrgId } });
    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Verify member exists and belongs to this org (globalDb)
    const existingMember = await globalDb.member.findFirst({
      where: { id: urlMemberId, orgId: urlOrgId },
      include: { user: { select: { name: true, email: true } } },
    });
    if (!existingMember) {
      return NextResponse.json({ error: 'Member not found in this organization' }, { status: 404 });
    }

    // Update member role within tenant context (tenantDb)
    const updatedMember = await runWithTenant(urlOrgId, async () => {
      return tenantDb.member.update({
        where: { id: urlMemberId },
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
      resourceId: urlMemberId,
      organizationId: urlOrgId,
      metadata: { newRole: role },
    });

    logger.info({ userId: session.user.id, orgId: urlOrgId, memberId: urlMemberId, role }, 'Updated member role in tenant organization');
    return NextResponse.json({ message: 'Member role updated', member: updatedMember });
  } catch (error) {
    const isDbError = error instanceof Error && error.message.includes("Can't reach database server");
    logger.error({ err: error, orgId: urlOrgId, memberId: urlMemberId }, isDbError ? 'Database unavailable updating member' : 'Unexpected error updating member');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal Server Error' }, { status: isDbError ? 503 : 500 });
  }
});

// ---------------------------------------------------------------------------
// DELETE — Remove a member from a tenant organization (super admin)
// ---------------------------------------------------------------------------

export const DELETE = wrapPiiRoute(async (request, _decryptedBody, params) => {
  // decryptedBody is null for DELETE requests
  const authResult = await requireSuperAdmin(request.headers);
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
  }

  const session = authResult.session!;

  // Rate limit admin write operations by session
  if (!checkAdminRateLimit(session.user.id)) {
    logger.warn({ userId: session.user.id }, 'Admin write rate limited');
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  // Extract orgId and memberId from route params (provided by wrapPiiRoute)
  const urlOrgId = params?.orgId;
  const urlMemberId = params?.memberId;

  if (!urlOrgId) {
    return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
  }
  if (!urlMemberId) {
    return NextResponse.json({ error: 'Member ID is required' }, { status: 400 });
  }

  try {
    // Verify target org exists (globalDb)
    const org = await globalDb.organization.findUnique({ where: { id: urlOrgId } });
    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Verify member exists and belongs to this org (globalDb)
    const existingMember = await globalDb.member.findFirst({
      where: { id: urlMemberId, orgId: urlOrgId },
      include: { user: { select: { name: true, email: true } } },
    });
    if (!existingMember) {
      return NextResponse.json({ error: 'Member not found in this organization' }, { status: 404 });
    }

    // Remove member within tenant context (tenantDb)
    await runWithTenant(urlOrgId, async () => {
      return tenantDb.member.delete({ where: { id: urlMemberId } });
    });

    // Audit log (globalDb)
    await recordAuditLog({
      userId: session.user.id,
      userName: session.user.name || undefined,
      action: 'member.deleted',
      success: true,
      resourceType: 'Organization.Member',
      resourceId: urlMemberId,
      organizationId: urlOrgId,
    });

    logger.info({ userId: session.user.id, orgId: urlOrgId, memberId: urlMemberId }, 'Removed member from tenant organization');
    return NextResponse.json({ message: 'Member removed successfully' });
  } catch (error) {
    const isDbError = error instanceof Error && error.message.includes("Can't reach database server");
    logger.error({ err: error, orgId: urlOrgId, memberId: urlMemberId }, isDbError ? 'Database unavailable removing member' : 'Unexpected error removing member');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal Server Error' }, { status: isDbError ? 503 : 500 });
  }
});
