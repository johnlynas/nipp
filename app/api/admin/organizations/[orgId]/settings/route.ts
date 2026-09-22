/**
 * PATCH /api/admin/organizations/[orgId]/settings
 *
 * Super Admin only — update organization settings (name, slug, status).
 * Wrapped with wrapPiiRoute for payload encryption.
 */

import { NextResponse } from 'next/server';
// RLS Phase 3: org settings run under a verified target-org context.
import tenantDb from '@/lib/tenant-db';
import { withTenantAdminContext } from '@/lib/platform-db';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { recordAuditLog } from '@/lib/audit-log';
import { logger } from '@/lib/logger';
import { wrapPiiRoute, PiiRouteParams } from '@/lib/payload-middleware';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

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

  // Rate limit admin write operations by session
  if (!checkAdminRateLimit(session.user.id)) {
    logger.warn({ userId: session.user.id }, 'Admin write rate limited');
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  // Get body from decrypted payload or parse JSON
  let body: { name?: string; slug?: string; status?: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED' };
  if (decryptedBody && typeof decryptedBody === 'object') {
    body = decryptedBody as typeof body;
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
    // RLS: verified target-org context wraps org read/update + session invalidation.
    return await withTenantAdminContext(session.user.id, orgId, async () => {
    // Verify target org exists (flag=1 admits any org row; RLS binds writes)
    const existingOrg = await tenantDb.organization.findUnique({ where: { id: orgId } });
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
        // Session has no RLS; Member filter is ctx-scoped (platform pass-through).
        await tenantDb.session.deleteMany({ where: { user: { members: { some: { orgId } } } } });
        logger.info({ userId: session.user.id, orgId }, 'Invalidated all sessions for suspended organization');
      }

      // Special handling for ARCHIVED: ensure no active members (warning only)
      if (status === 'ARCHIVED') {
        const memberCount = await tenantDb.member.count({ where: { orgId } });
        if (memberCount > 0) {
          logger.warn({ userId: session.user.id, orgId, memberCount }, 'Archiving organization with active members');
        }
      }
    }

    // Validate slug uniqueness (platform flag exposes all orgs for the check)
    if (slug && slug !== existingOrg.slug) {
      const slugCollision = await tenantDb.organization.findFirst({ where: { slug, id: { not: orgId } } });
      if (slugCollision) {
        return NextResponse.json({ error: 'Slug already in use by another organization' }, { status: 409 });
      }
    }

    // Build update data (only include provided fields)
    const updateData: { name?: string; slug?: string; status?: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED' } = {};
    if (name) updateData.name = name;
    if (slug) updateData.slug = slug;
    if (status) updateData.status = status;

    // Update organization (RLS Organization UPDATE policy: platform actor context)
    const updatedOrg = await tenantDb.organization.update({
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
    });
  } catch (error) {
    const isDbError =
      error instanceof Error &&
      (error.message.includes("Can't reach database server") || error.message.includes('Platform organization not found'));
    logger.error({ err: error, orgId }, isDbError ? 'Database unavailable updating settings' : 'Unexpected error updating settings');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal Server Error' }, { status: isDbError ? 503 : 500 });
  }
});
