/**
 * GET /api/admin/organizations/:id
 * PATCH /api/admin/organizations/:id
 * DELETE /api/admin/organizations/:id (archive)
 *
 * Super Admin only — manage a specific organization.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import globalDb from '@/lib/global-db';
import { requireSuperAdmin, getRequestMetadata } from '@/lib/require-super-admin';
import { recordAuditLog } from '@/lib/audit-log';

export const runtime = 'nodejs';

/**
 * GET — Get organization detail.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireSuperAdmin(_request.headers);
  if (authError) return authError;

  const { id } = await params;

  const organization = await globalDb.organization.findUnique({
    where: { id },
    include: {
      members: { select: { id: true, userId: true, role: true, user: { select: { name: true, email: true } } } },
      roles: { where: { isDefault: false }, select: { id: true, name: true } },
    },
  });

  if (!organization) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }

  return NextResponse.json({
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    status: organization.status,
    metadata: organization.metadata,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
    memberCount: organization.members.length,
    customRoleCount: organization.roles.length,
  });
}

/**
 * PATCH — Update organization.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireSuperAdmin(request.headers);
  if (authError) return authError;

  const { id } = await params;
  const body = await request.json();
  const { name, slug } = body as { name?: string; slug?: string };

  if (!name && !slug) {
    return NextResponse.json(
      { error: 'Provide name or slug to update' },
      { status: 400 }
    );
  }

  const session = await auth.api.getSession({ headers: request.headers });
  const { ipAddress, userAgent } = getRequestMetadata(request);

  try {
    const organization = await globalDb.organization.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(slug && { slug }),
      },
    });

    await recordAuditLog({
      userId: session?.user?.id,
      userName: session?.user?.name,
      action: 'organization.updated',
      resourceType: 'Organization',
      resourceId: organization.id,
      organizationId: null,
      ipAddress,
      userAgent,
      success: true,
      metadata: { name, slug },
    });

    return NextResponse.json({ organization });
  } catch (error) {
    console.error('[Admin Org] Failed to update organization:', error);
    return NextResponse.json(
      { error: 'Failed to update organization' },
      { status: 500 }
    );
  }
}

/**
 * DELETE — Archive organization (terminal state).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireSuperAdmin(request.headers);
  if (authError) return authError;

  const { id } = await params;

  const session = await auth.api.getSession({ headers: request.headers });
  const { ipAddress, userAgent } = getRequestMetadata(request);

  try {
    // Check current status before archiving
    const org = await globalDb.organization.findUnique({
      where: { id },
      select: { status: true, name: true },
    });

    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    if (org.status === 'ARCHIVED') {
      return NextResponse.json(
        { error: 'Organization is already archived (terminal state)' },
        { status: 400 }
      );
    }

    if (org.status === 'PENDING') {
      // For pending orgs, hard delete instead of archive
      await globalDb.organization.delete({ where: { id } });

      await recordAuditLog({
        userId: session?.user?.id,
        userName: session?.user?.name,
        action: 'organization.deleted',
        resourceType: 'Organization',
        resourceId: id,
        organizationId: null,
        ipAddress,
        userAgent,
        success: true,
        metadata: { name: org.name },
      });

      return NextResponse.json({ success: true, message: 'Organization deleted' });
    }

    // Archive active/suspended orgs
    await globalDb.organization.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });

    await recordAuditLog({
      userId: session?.user?.id,
      userName: session?.user?.name,
      action: 'organization.archived',
      resourceType: 'Organization',
      resourceId: id,
      organizationId: null,
      ipAddress,
      userAgent,
      success: true,
      metadata: { name: org.name },
    });

    return NextResponse.json({ success: true, message: 'Organization archived' });
  } catch (error) {
    console.error('[Admin Org] Failed to archive organization:', error);
    return NextResponse.json(
      { error: 'Failed to archive organization' },
      { status: 500 }
    );
  }
}
