/**
 * GET /api/admin/organizations/:id
 * PATCH /api/admin/organizations/:id
 * DELETE /api/admin/organizations/:id (archive)
 *
 * Super Admin only — manage a specific organization.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import globalDb from '@/lib/global-db';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * Helper function to check if user is Super Admin
 */
async function checkSuperAdmin(headersList: Headers): Promise<{ session: any; isSuperAdmin: boolean }> {
  const session = await auth.api.getSession({ headers: headersList });
  
  if (!session) {
    return { session: null, isSuperAdmin: false };
  }
  
  let isSuperAdmin = false;
  
  try {
    const { getPlatformOrgId } = await import('@/lib/authz');
    const platformOrgId = await getPlatformOrgId();
    
    const superAdminCheck = await prisma.member.findFirst({
      where: {
        userId: session.user.id,
        orgId: platformOrgId,
      },
    });
    
    isSuperAdmin = !!superAdminCheck;
  } catch (error) {
    // Fallback to email check if DB is unavailable
    const userEmail = (session.user as any).email;
    const knownSuperAdminEmail = process.env.SUPER_ADMIN_EMAIL || 'admin@nipp.gov.uk';
    isSuperAdmin = userEmail === knownSuperAdminEmail;
  }
  
  return { session, isSuperAdmin };
}

/**
 * GET — Get organization detail.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    console.log('[ORG_DETAIL_API] GET request received');
    
    const { session, isSuperAdmin } = await checkSuperAdmin(_request.headers);
    
    if (!session) {
      console.log('[ORG_DETAIL_API] No session found');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    if (!isSuperAdmin) {
      console.log('[ORG_DETAIL_API] User is not Super Admin');
      return NextResponse.json({ error: 'Super Admin access required' }, { status: 403 });
    }
    
    console.log('[ORG_DETAIL_API] Session found for user:', session.user.id);
    
    const { id } = await params;

    const organization = await globalDb.organization.findUnique({
      where: { id },
      include: {
        members: { select: { id: true, userId: true, role: true, user: { select: { name: true, email: true } } } },
        roles: { where: { isDefault: false }, select: { id: true, name: true } },
      },
    });

    if (!organization) {
      console.log('[ORG_DETAIL_API] Organization not found:', id);
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    console.log('[ORG_DETAIL_API] Organization found:', organization.id);

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
  } catch (error) {
    console.error('[ORG_DETAIL_API] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH — Update organization.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    console.log('[ORG_DETAIL_API] PATCH request received');
    
    const { session, isSuperAdmin } = await checkSuperAdmin(request.headers);
    
    if (!session) {
      console.log('[ORG_DETAIL_API] No session found');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    if (!isSuperAdmin) {
      console.log('[ORG_DETAIL_API] User is not Super Admin');
      return NextResponse.json({ error: 'Super Admin access required' }, { status: 403 });
    }
    
    console.log('[ORG_DETAIL_API] Session found for user:', session.user.id);

    const { id } = await params;
    const body = await request.json();
    const { name, slug } = body as { name?: string; slug?: string };

    if (!name && !slug) {
      return NextResponse.json(
        { error: 'Provide name or slug to update' },
        { status: 400 }
      );
    }

    try {
      const organization = await globalDb.organization.update({
        where: { id },
        data: {
          ...(name && { name }),
          ...(slug && { slug }),
        },
      });

      return NextResponse.json({ organization });
    } catch (error) {
      console.error('[ORG_DETAIL_API] Failed to update organization:', error);
      return NextResponse.json(
        { error: 'Failed to update organization' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[ORG_DETAIL_API] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE — Archive organization (terminal state).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    console.log('[ORG_DETAIL_API] DELETE request received');
    
    const { session, isSuperAdmin } = await checkSuperAdmin(request.headers);
    
    if (!session) {
      console.log('[ORG_DETAIL_API] No session found');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    if (!isSuperAdmin) {
      console.log('[ORG_DETAIL_API] User is not Super Admin');
      return NextResponse.json({ error: 'Super Admin access required' }, { status: 403 });
    }
    
    console.log('[ORG_DETAIL_API] Session found for user:', session.user.id);

    const { id } = await params;

    try {
      // Check current status before archiving
      const org = await globalDb.organization.findUnique({
        where: { id },
        select: { status: true, name: true },
      });

      if (!org) {
        console.log('[ORG_DETAIL_API] Organization not found:', id);
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

        return NextResponse.json({ success: true, message: 'Organization deleted' });
      }

      // Archive active/suspended orgs
      await globalDb.organization.update({
        where: { id },
        data: { status: 'ARCHIVED' },
      });

      return NextResponse.json({ success: true, message: 'Organization archived' });
    } catch (error) {
      console.error('[ORG_DETAIL_API] Failed to archive organization:', error);
      return NextResponse.json(
        { error: 'Failed to archive organization' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[ORG_DETAIL_API] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
