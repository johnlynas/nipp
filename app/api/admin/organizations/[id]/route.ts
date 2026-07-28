import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache, revalidateTag } from 'next/cache';
import { auth } from '@/lib/auth';
import globalDb from '@/lib/global-db';
import { verifySuperAdmin } from '@/lib/authz';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

// P7: Cache dynamic org details with static tag (invalidated via revalidateTag('org') on mutations)
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

async function checkSuperAdmin(headersList: Headers): Promise<{ session: Awaited<ReturnType<typeof auth.api.getSession>> | null; isSuperAdmin: boolean; error?: string }> {
  const session = await auth.api.getSession({ headers: headersList });
  if (!session) return { session: null, isSuperAdmin: false };
  
  const { authorized, error } = await verifySuperAdmin(session.user.id, undefined);
  return { session, isSuperAdmin: authorized, error };
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    logger.info({ route: '/api/admin/organizations/[id]', method: 'GET' }, 'Request received');
    const { session, isSuperAdmin, error } = await checkSuperAdmin(_request.headers);
    
    if (!session) {
      logger.warn({ method: 'GET' }, 'No session found');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!isSuperAdmin) {
      const status = error?.includes('Database unavailable') ? 503 : 403;
      logger.warn({ userId: session.user.id, error, status }, 'Super admin verification failed');
      return NextResponse.json({ error: error || 'Super Admin access required' }, { status });
    }
    
    const { id } = await params;
    // P7: Use cached query with tags for targeted invalidation
    const organization = await getOrgDetails(id);
    
    if (!organization) {
      logger.warn({ orgId: id, method: 'GET' }, 'Organization not found');
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
    logger.error({ err: error, method: 'GET' }, 'Unexpected error in GET handler');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    logger.info({ route: '/api/admin/organizations/[id]', method: 'PATCH' }, 'Request received');
    const { session, isSuperAdmin, error } = await checkSuperAdmin(request.headers);
    
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isSuperAdmin) {
      const status = error?.includes('Database unavailable') ? 503 : 403;
      return NextResponse.json({ error: error || 'Super Admin access required' }, { status });
    }
    
    const { id } = await params;
    const body = await request.json();
    const { name, slug } = body as { name?: string; slug?: string };
    
    if (!name && !slug) return NextResponse.json({ error: 'Provide name or slug to update' }, { status: 400 });
    
    try {
      const organization = await globalDb.organization.update({
        where: { id }, data: { ...(name && { name }), ...(slug && { slug }) },
      });
      return NextResponse.json({ organization });
    } catch (error) {
      logger.error({ err: error, orgId: id, method: 'PATCH' }, 'Failed to update organization');
      return NextResponse.json({ error: 'Failed to update organization' }, { status: 500 });
    }
  } catch (error) {
    logger.error({ err: error, method: 'PATCH' }, 'Unexpected error in PATCH handler');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    logger.info({ route: '/api/admin/organizations/[id]', method: 'DELETE' }, 'Request received');
    const { session, isSuperAdmin, error } = await checkSuperAdmin(request.headers);
    
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isSuperAdmin) {
      const status = error?.includes('Database unavailable') ? 503 : 403;
      return NextResponse.json({ error: error || 'Super Admin access required' }, { status });
    }
    
    const { id } = await params;
    try {
      const org = await globalDb.organization.findUnique({ where: { id }, select: { status: true, name: true } });
      if (!org) {
        logger.warn({ orgId: id, method: 'DELETE' }, 'Organization not found');
        return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
      }
      if (org.status === 'ARCHIVED') {
        return NextResponse.json({ error: 'Organization is already archived (terminal state)' }, { status: 400 });
      }
      if (org.status === 'PENDING') {
        await globalDb.organization.delete({ where: { id } });
        logger.info({ orgId: id, method: 'DELETE' }, 'Pending organization hard deleted');
        // P7: Invalidate cached org details
        revalidateTag('org');
        return NextResponse.json({ success: true, message: 'Organization deleted' });
      }
      
      await globalDb.organization.update({ where: { id }, data: { status: 'ARCHIVED' } });
      logger.info({ orgId: id, method: 'DELETE' }, 'Organization archived');
      // P7: Invalidate cached org details
      revalidateTag('org');
      return NextResponse.json({ success: true, message: 'Organization archived' });
    } catch (error) {
      logger.error({ err: error, orgId: id, method: 'DELETE' }, 'Failed to archive organization');
      return NextResponse.json({ error: 'Failed to archive organization' }, { status: 500 });
    }
  } catch (error) {
    logger.error({ err: error, method: 'DELETE' }, 'Unexpected error in DELETE handler');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}