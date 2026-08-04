/**
 * PATCH /api/admin/organizations/[orgId]/settings
 *
 * Super Admin only — update organization settings (name, slug, status).
 * Wrapped with wrapPiiRoute for payload encryption.
 */

import { NextRequest, NextResponse } from 'next/server';
import globalDb from '@/lib/global-db';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { recordAuditLog } from '@/lib/audit-log';
import { logger } from '@/lib/logger';
import { wrapPiiRoute } from '@/lib/payload-middleware';

export const runtime = 'nodejs';
export const revalidate = 0;
export const dynamic = 'force-dynamic';

// Organization status state machine transitions
const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['ACTIVE'],
  ACTIVE: ['SUSPENDED', 'PENDING'],
  SUSPENDED: ['ACTIVE'],
  ARCHIVED: [], // Terminal — no transitions allowed
};

// ---------------------------------------------------------------------------
// PATCH — Update organization settings (super admin, wrapped with payload encryption)
// ---------------------------------------------------------------------------

export const PATCH = wrapPiiRoute(async (request, decryptedBody, params) => {
  // Auth check — wrapPiiRoute handles encryption, not authorization
  const authResult = await requireSuperAdmin(request.headers);
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
  }

  const session = authResult.session!;

  // Get body from decrypted payload or parse JSON
  let body: { name?: string; slug?: string; status?: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED' };
  if (decryptedBody && typeof decryptedBody === 'object') {
    body = decryptedBody as typeof body;
  } else {
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
  }

  const { name, slug, status } = body;

  if (!name && !slug && !status) {
    return NextResponse.json({ error: 'Provide name, slug, or status to update' }, { status: 400 });
  }

  // Extract orgId from route params (provided by wrapPiiRoute)
  const orgId = params?.orgId;

  if (!orgId) {
    return NextResponse.json({ error: 'Organization ID required' }, { status: 400 });
  }

  try {
    // Verify target org exists (globalDb)
    const existingOrg = await globalDb.organization.findUnique({ where: { id: orgId } });
    if (!existingOrg) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Validate status transition (state machine)
    if (status && status !== existingOrg.status) {
      const allowed = VALID_TRANSITIONS[existingOrg.status];
      if (!allowed?.includes(status)) {
        return NextResponse.json(
          { error: `Invalid status transition from ${existingOrg.status} to ${status}` },
          { status: 400 }
        );
      }

      // Special handling for SUSPENDED: invalidate sessions
      if (status === 'SUSPENDED') {
        await globalDb.session.deleteMany({ where: { user: { members: { some: { orgId } } } } });
        logger.info({ userId: session.user.id, orgId }, 'Invalidated all sessions for suspended organization');
      }

      // Special handling for ARCHIVED: ensure no active members (warning only)
      if (status === 'ARCHIVED') {
        const memberCount = await globalDb.member.count({ where: { orgId } });
        if (memberCount > 0) {
          logger.warn({ userId: session.user.id, orgId, memberCount }, 'Archiving organization with active members');
        }
      }
    }

    // Validate slug uniqueness (globalDb)
    if (slug && slug !== existingOrg.slug) {
      const slugCollision = await globalDb.organization.findFirst({ where: { slug, id: { not: orgId } } });
      if (slugCollision) {
        return NextResponse.json({ error: 'Slug already in use by another organization' }, { status: 409 });
      }
    }

    // Build update data (only include provided fields)
    const updateData: { name?: string; slug?: string; status?: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED' } = {};
    if (name) updateData.name = name;
    if (slug) updateData.slug = slug;
    if (status) updateData.status = status;

    // Update organization (globalDb — Organization model is global, not org-scoped)
    const updatedOrg = await globalDb.organization.update({
      where: { id: orgId },
      data: updateData,
    });

    // Audit log (globalDb)
    await recordAuditLog({
      userId: session.user.id,
      userName: session.user.name || undefined,
      action: 'organization.settings_updated',
      success: true,
      resourceType: 'Organization',
      resourceId: orgId,
      organizationId: orgId,
      metadata: { changes: Object.keys(updateData) },
    });

    logger.info({ userId: session.user.id, orgId, changes: Object.keys(updateData) }, 'Updated organization settings');
    return NextResponse.json({ message: 'Organization updated', organization: updatedOrg });
  } catch (error) {
    const isDbError =
      error instanceof Error &&
      (error.message.includes('Can\'t reach database server') || error.message.includes('Platform organization not found'));
    logger.error({ err: error, orgId }, isDbError ? 'Database unavailable updating settings' : 'Unexpected error updating settings');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal Server Error' }, { status: isDbError ? 503 : 500 });
  }
});
