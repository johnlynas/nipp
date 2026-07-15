/**
 * GET /api/admin/permissions
 * POST /api/admin/permissions
 * PATCH /api/admin/permissions/:id
 * DELETE /api/admin/permissions/:id
 *
 * Super Admin only — global permission catalog CRUD.
 */

import { NextRequest, NextResponse } from 'next/server';
import globalDb from '@/lib/global-db';
import { requireSuperAdmin, getRequestMetadata } from '@/lib/require-super-admin';
import { recordAuditLog } from '@/lib/audit-log';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { setRLSContext } from '@/lib/rls';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ✅ CRITICAL: Set RLS Context before ANY database queries
    const orgId = session.session.activeOrganizationId || env.PLATFORM_ORGANIZATION_ID!;
    await setRLSContext(session.user.id, orgId);

    // Get query parameters for filtering
    const searchParams = request.nextUrl.searchParams;
    const resource = searchParams.get('resource');
    const search = searchParams.get('search') || '';

    // Build where clause
    const where: any = {};
    
    if (resource) {
      where.resource = resource;
    }
    
    if (search) {
      where.OR = [
        { key: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    // ✅ Fetch permissions - RLS policy 'permission_read_all' allows this
    const permissions = await prisma.permission.findMany({
      where,
      orderBy: [
        { resource: 'asc' },
        { action: 'asc' },
      ],
    });

    return NextResponse.json({ permissions });
  } catch (error) {
    console.error('[Permissions API] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ✅ Set RLS Context
    const orgId = session.session.activeOrganizationId || env.PLATFORM_ORGANIZATION_ID!;
    await setRLSContext(session.user.id, orgId);

    const body = await request.json();
    const { key, resource, action, description } = body;

    if (!key || !resource || !action) {
      return NextResponse.json({ 
        error: 'Key, resource, and action are required' 
      }, { status: 400 });
    }

    const permission = await prisma.permission.create({
      data: {
        key,
        resource,
        action,
        description,
      },
    });

    return NextResponse.json({ permission }, { status: 201 });
  } catch (error) {
    console.error('[Permissions API] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * PATCH — Update a permission.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireSuperAdmin(request.headers);
  if (authError) return authError;

  const { id } = await params;
  const body = await request.json();
  const { description, key } = body as { description?: string; key?: string };

  if (!description && !key) {
    return NextResponse.json(
      { error: 'Provide description or key to update' },
      { status: 400 }
    );
  }

  const session = await (await import('@/lib/auth')).auth.api.getSession({
    headers: request.headers,
  });

  const permission = await globalDb.permission.update({
    where: { id },
    data: { ...(description && { description }), ...(key && { key }) },
  });

  await recordAuditLog({
    userId: session?.user?.id,
    userName: session?.user?.name,
    action: 'permission.updated',
    resourceType: 'Permission',
    resourceId: permission.id,
    organizationId: null,
    ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
    userAgent: request.headers.get('user-agent') || 'unknown',
    success: true,
    metadata: { key: permission.key },
  });

  return NextResponse.json({ permission });
}

/**
 * DELETE — Delete a permission from the global catalog.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireSuperAdmin(_request.headers);
  if (authError) return authError;

  const { id } = await params;

  const session = await (await import('@/lib/auth')).auth.api.getSession({
    headers: _request.headers,
  });

  const permission = await globalDb.permission.findUnique({ where: { id } });
  if (!permission) {
    return NextResponse.json({ error: 'Permission not found' }, { status: 404 });
  }

  // Check if permission is used by any roles
  const usageCount = await globalDb.rolePermission.count({
    where: { permissionId: id },
  });

  if (usageCount > 0) {
    return NextResponse.json(
      { error: `Cannot delete permission used by ${usageCount} role(s)` },
      { status: 400 }
    );
  }

  await globalDb.permission.delete({ where: { id } });

  await recordAuditLog({
    userId: session?.user?.id,
    userName: session?.user?.name,
    action: 'permission.deleted',
    resourceType: 'Permission',
    resourceId: id,
    organizationId: null,
    ipAddress: _request.headers.get('x-forwarded-for') || 'unknown',
    userAgent: _request.headers.get('user-agent') || 'unknown',
    success: true,
    metadata: { key: permission.key },
  });

  return NextResponse.json({ success: true, message: 'Permission deleted' });
}
