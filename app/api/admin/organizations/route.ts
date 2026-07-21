import { NextRequest, NextResponse } from 'next/server';
import { withSuperAdmin } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';

export const GET = withSuperAdmin(async (request, context) => {
  try {
    logger.info({ route: '/api/admin/organizations', method: 'GET' }, 'Request received');
    logger.info({ userId: context.user.id, method: 'GET' }, 'Session found');
    
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const pageSize = parseInt(url.searchParams.get('pageSize') || '20', 10);
    const skip = (page - 1) * pageSize;
    
    logger.debug({ page, pageSize, skip, method: 'GET' }, 'Fetching organizations with pagination');
    
    const [organizations, total] = await Promise.all([
      prisma.organization.findMany({
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { members: true } } },
      }),
      prisma.organization.count(),
    ]);
    
    logger.info({ count: organizations.length, total, method: 'GET' }, 'Found organizations');
    
    return NextResponse.json({
      organizations,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (error) {
    logger.error({ err: error, route: '/api/admin/organizations', method: 'GET' }, 'Unexpected error in GET handler');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});

export const POST = withSuperAdmin(async (request, context) => {
  try {
    logger.info({ route: '/api/admin/organizations', method: 'POST' }, 'Request received');
    logger.info({ userId: context.user.id, method: 'POST' }, 'Session found');
    
    let body;
    try {
      body = await request.json();
      logger.debug({ method: 'POST' }, 'Request body parsed');
    } catch (parseError) {
      logger.error({ err: parseError, method: 'POST' }, 'Failed to parse request body');
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    
    const { name, slug, adminEmail } = body as { name?: string; slug?: string; adminEmail?: string };
    if (!name) {
      return NextResponse.json({ error: 'Organization name is required' }, { status: 400 });
    }
    
    const existingOrgByName = await prisma.organization.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (existingOrgByName) {
      return NextResponse.json({ error: 'An organization with this name already exists' }, { status: 400 });
    }
    
    let generatedSlug = slug || name.toLowerCase().replace(/\s+/g, '-');
    let slugSuffix = 1;
    let uniqueSlug = generatedSlug;
    
    while (true) {
      const existingOrg = await prisma.organization.findUnique({ where: { slug: uniqueSlug } });
      if (!existingOrg) break;
      uniqueSlug = `${generatedSlug}-${slugSuffix}`;
      slugSuffix++;
      if (slugSuffix > 100) {
        return NextResponse.json({ error: 'Unable to generate unique slug' }, { status: 400 });
      }
    }
    
    logger.debug({ slug: uniqueSlug, method: 'POST' }, 'Using unique slug');
    
    const organization = await prisma.organization.create({ data: { name, slug: uniqueSlug } });
    logger.info({ orgId: organization.id, method: 'POST' }, 'Organization created');
    
    if (adminEmail) {
      try {
        let user = await prisma.user.findUnique({ where: { email: adminEmail } });
        if (!user) {
          user = await prisma.user.create({
            data: { email: adminEmail, name: adminEmail.split('@')[0], emailVerified: true },
          });
          logger.debug({ userId: user.id, method: 'POST' }, 'User created');
        }
        await prisma.member.create({ data: { userId: user.id, orgId: organization.id, role: 'admin' } });
        logger.debug({ userId: user.id, orgId: organization.id, method: 'POST' }, 'Member relationship created');
      } catch (userError) {
        logger.error({ err: userError, adminEmail, orgId: organization.id, method: 'POST' }, 'Error creating user/member, but organization was created');
      }
    }
    
    return NextResponse.json({ message: 'Organization created successfully', organization }, { status: 201 });
    
  } catch (error) {
    logger.error({ err: error, route: '/api/admin/organizations', method: 'POST' }, 'Unexpected error in POST handler');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
