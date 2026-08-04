import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache, revalidateTag } from 'next/cache';
import globalDb from '@/lib/global-db';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { recordAuditLog } from '@/lib/audit-log';
import { logger } from '@/lib/logger';
import { wrapPiiRoute, PiiRouteParams } from '@/lib/payload-middleware';

export const runtime = 'nodejs';
export const revalidate = 0;
export const dynamic = 'force-dynamic';

// P7: Cache dynamic org details with static tag (invalidated via revalidateTag('org') on mutations)
// Note: This caches database data only; wrapPiiRoute encrypts each response separately.
const getOrgDetails = unstable_cache(
  async (id: string) => {
    return globalDb.organization.findUnique({
      where: { id },
      include: {
        members: { select: { id: true, userId: true, role: true, user: { select: { name: true, email: true } } } },
        roles: { where: { isDefault: false }, select: { id: true, name: true } },
      },
    });
  },
  ['org'],
  { revalidate: 30 }
);

// ---------------------------------------------------------------------------
// GET — Fetch organization details by ID
// ---------------------------------------------------------------------------

export const GET = wrapPiiRoute(async (request, _decryptedBody, params) => {
  // decryptedBody is null for GET requests

  try {
    logger.info({ route: '/api/admin/organizations/[orgId]', method: 'GET' }, 'Request received');

    const authResult = await requireSuperAdmin(request.headers);
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
    }

    const session = authResult.session!;

    // Extract orgId from route params (provided by wrapPiiRoute)
    const orgId = params?.orgId;
    if (!orgId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

    // P7: Use cached query with tags for targeted invalidation
    const organization = await getOrgDetails(orgId);

    if (!organization) {
      logger.warn({ orgId, method: 'GET' }, 'Organization not found');
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    logger.info({ orgId: organization.id, method: 'GET' }, 'Organization found');
    return NextResponse.json({
      id: organization.id, name: organization.name, slug: organization.slug,
      status: organization.status, metadata: organization.metadata,
      createdAt: organization.createdAt, updatedAt: organization.updatedAt,
      memberCount: organization.members.length, customRoleCount: organization.roles.length,
    });
  } catch (error) {
    const isDbError = error instanceof Error && error.message.includes('Can\'t reach database server');
    logger.error({ err: error, method: 'GET' }, isDbError ? 'Database unavailable fetching org details' : 'Unexpected error fetching org details');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal server error' }, { status: isDbError ? 503 : 500 });
  }
});

// ---------------------------------------------------------------------------
// PATCH — Update organization details by ID
// ---------------------------------------------------------------------------

export const PATCH = wrapPiiRoute(async (request, decryptedBody, params) => {
  try {
    const authResult = await requireSuperAdmin(request.headers);
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
    }

    const session = authResult.session!;

    // Extract orgId from route params (provided by wrapPiiRoute)
    const orgId = params?.orgId;
    if (!orgId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

    // Get body from decrypted payload or parse JSON
    let body: { name?: string; slug?: string };
    if (decryptedBody && typeof decryptedBody === 'object') {
      body = decryptedBody as typeof body;
    } else {
      try {
        body = await request.json();
      } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
      }
    }

    const existingOrg = await globalDb.organization.findUnique({ where: { id: orgId } });
    if (!existingOrg) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const updateData: { name?: string; slug?: string } = {};
    if (body.name) updateData.name = body.name;
    if (body.slug && body.slug !== existingOrg.slug) {
      const slugCollision = await globalDb.organization.findFirst({ where: { slug: body.slug, id: { not: orgId } } });
      if (slugCollision) {
        return NextResponse.json({ error: 'Slug already in use by another organization' }, { status: 409 });
      }
      updateData.slug = body.slug;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const updatedOrg = await globalDb.organization.update({
      where: { id: orgId },
      data: updateData,
    });

    revalidateTag('org');

    logger.info({ userId: session.user.id, orgId }, 'Updated organization details');

    // Record audit log for organization update
    await recordAuditLog({
      userId: session.user.id,
      userName: (session.user as { name?: string }).name ?? undefined,
      action: 'organization.updated',
      resourceType: 'Organization',
      resourceId: orgId,
      organizationId: orgId,
      metadata: { changes: Object.keys(updateData) },
      success: true,
    }).catch((err) => logger.error({ err }, 'Failed to record audit log for org update'));

    return NextResponse.json({ message: 'Organization updated', organization: updatedOrg });
  } catch (error) {
    const isDbError = error instanceof Error && error.message.includes('Can\'t reach database server');
    logger.error({ err: error, method: 'PATCH' }, isDbError ? 'Database unavailable updating org details' : 'Unexpected error updating org details');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal server error' }, { status: isDbError ? 503 : 500 });
  }
});

// ---------------------------------------------------------------------------
// DELETE — Archive organization by ID (state-machine enforced)
//
// PENDING organizations may be hard-deleted.
// All other states transition to ARCHIVED (terminal).
// ---------------------------------------------------------------------------

export const DELETE = wrapPiiRoute(async (request, _decryptedBody, params) => {
  try {
    const authResult = await requireSuperAdmin(request.headers);
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
    }

    const session = authResult.session!;

    // Extract orgId from route params (provided by wrapPiiRoute)
    const orgId = params?.orgId;
    if (!orgId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

    const existingOrg = await globalDb.organization.findUnique({ where: { id: orgId } });
    if (!existingOrg) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // PENDING organizations can be hard-deleted (never activated)
    if (existingOrg.status === 'PENDING') {
      await globalDb.organization.delete({ where: { id: orgId } });
      revalidateTag('org');

      // Record audit log for hard delete of pending org
      await recordAuditLog({
        userId: session.user.id,
        userName: (session.user as { name?: string }).name ?? undefined,
        action: 'organization.deleted',
        resourceType: 'Organization',
        resourceId: orgId,
        organizationId: orgId,
        success: true,
      }).catch((err) => logger.error({ err }, 'Failed to record audit log for org delete'));

      logger.info({ orgId }, 'Hard-deleted pending organization');
      return NextResponse.json({ message: 'Organization deleted' });
    }

    // ARCHIVED is terminal — nothing to do
    if (existingOrg.status === 'ARCHIVED') {
      return NextResponse.json({ error: 'Organization is already archived' }, { status: 400 });
    }

    // All other states (ACTIVE, SUSPENDED) → ARCHIVED
    await globalDb.organization.update({
      where: { id: orgId },
      data: { status: 'ARCHIVED' as const },
    });

    revalidateTag('org');

    // Record audit log for archive action
    await recordAuditLog({
      userId: session.user.id,
      userName: (session.user as { name?: string }).name ?? undefined,
      action: 'organization.archived',
      resourceType: 'Organization',
      resourceId: orgId,
      organizationId: orgId,
      metadata: { fromStatus: existingOrg.status },
      success: true,
    }).catch((err) => logger.error({ err }, 'Failed to record audit log for org archive'));

    logger.info({ orgId, fromStatus: existingOrg.status }, 'Archived organization');
    return NextResponse.json({ message: 'Organization archived' });
  } catch (error) {
    const isDbError = error instanceof Error && error.message.includes('Can\'t reach database server');
    logger.error({ err: error, method: 'DELETE' }, isDbError ? 'Database unavailable archiving org' : 'Unexpected error archiving org');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal server error' }, { status: isDbError ? 503 : 500 });
  }
});
