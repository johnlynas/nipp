/**
 * GET /api/admin/organizations/[orgId]/members
 * POST /api/admin/organizations/[orgId]/members
 *
 * Super Admin only — manage members of any tenant organization.
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

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// GET — List all members of a tenant organization (super admin)
// ---------------------------------------------------------------------------

export const GET = wrapPiiRoute(async (request, _decryptedBody, params) => {
  // decryptedBody is null for GET requests
  const authResult = await requireSuperAdmin(request.headers);
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
  }

  const session = authResult.session!;

  // Extract orgId from route params (provided by wrapPiiRoute)
  const urlOrgId = params?.orgId;
  if (!urlOrgId) {
    return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
  }

  try {
    // Verify target org exists (globalDb — cross-org lookup)
    const org = await globalDb.organization.findUnique({ where: { id: urlOrgId } });
    if (!org) {
      logger.warn({ userId: session.user.id, orgId: urlOrgId }, 'Tenant organization not found');
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Fetch members within tenant context (tenantDb — scoped to orgId)
    const members = await runWithTenant(urlOrgId, async () => {
      return tenantDb.member.findMany({
        where: { organization: { id: urlOrgId } },
        include: {
          user: { select: { id: true, name: true, email: true } },
          memberRoles: { include: { role: { select: { name: true, isDefault: true } } } },
        },
        orderBy: { createdAt: 'asc' },
      });
    });

    logger.info({ userId: session.user.id, orgId: urlOrgId, count: members.length }, 'Fetched tenant members');
    return NextResponse.json({ members });
  } catch (error) {
    const isDbError = error instanceof Error && error.message.includes('Can\'t reach database server');
    logger.error({ err: error, orgId: urlOrgId }, isDbError ? 'Database unavailable fetching members' : 'Unexpected error fetching members');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal Server Error' }, { status: isDbError ? 503 : 500 });
  }
});

// ---------------------------------------------------------------------------
// POST — Add a member to a tenant organization (super admin)
// ---------------------------------------------------------------------------

export const POST = wrapPiiRoute(async (request, decryptedBody, params) => {
  const authResult = await requireSuperAdmin(request.headers);
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
  }

  const session = authResult.session!;

  // Extract orgId from route params (provided by wrapPiiRoute)
  const urlOrgId = params?.orgId;
  if (!urlOrgId) {
    return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
  }

  // Use decryptedBody (already parsed JSON) or fall back to request.json()
  let body: { email?: string; role?: string };
  if (decryptedBody && typeof decryptedBody === 'object') {
    body = decryptedBody as { email?: string; role?: string };
  } else {
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
  }

  const { email, role } = body;
  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  try {
    // Verify target org exists (globalDb)
    const org = await globalDb.organization.findUnique({ where: { id: urlOrgId } });
    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Find or create user (globalDb — User model is global)
    let user = await globalDb.user.findUnique({ where: { email } });
    if (!user) {
      // Create user with a temporary password hash (they'll need to set one via email)
      const { hashPassword } = await import('better-auth/crypto');
      const tempPassword = Math.random().toString(36).slice(-12);
      user = await globalDb.user.create({
        data: {
          email,
          name: email.split('@')[0],
          emailVerified: false,
          passwordHash: await hashPassword(tempPassword),
        },
      });
    }

    // Check if already a member (globalDb — Member is global)
    const existingMember = await globalDb.member.findFirst({
      where: { userId: user.id, orgId: urlOrgId },
    });
    if (existingMember) {
      return NextResponse.json({ error: 'User is already a member of this organization' }, { status: 409 });
    }

    // Add member within tenant context (tenantDb)
    const member = await runWithTenant(urlOrgId, async () => {
      return tenantDb.member.create({
        data: { userId: user.id, orgId: urlOrgId, role: role || 'member' },
        include: { user: { select: { name: true, email: true } } },
      });
    });

    // Audit log (globalDb)
    await recordAuditLog({
      userId: session.user.id,
      userName: session.user.name || undefined,
      action: 'member.created',
      success: true,
      resourceType: 'Organization.Member',
      resourceId: member.id,
      organizationId: urlOrgId,
    });

    logger.info({ userId: session.user.id, orgId: urlOrgId, memberId: member.id }, 'Added member to tenant organization');
    return NextResponse.json({ message: 'Member added successfully', member }, { status: 201 });
  } catch (error) {
    const isDbError = error instanceof Error && error.message.includes('Can\'t reach database server');
    logger.error({ err: error, orgId: urlOrgId }, isDbError ? 'Database unavailable adding member' : 'Unexpected error adding member');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal Server Error' }, { status: isDbError ? 503 : 500 });
  }
});
