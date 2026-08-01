import { NextRequest, NextResponse } from 'next/server';
import { withSuperAdmin } from '@/lib/middleware/auth';
import { OrganizationService } from '@/services/organization-service';
import { logger } from '@/lib/logger';

// Disable Next.js ISR caching — this is a dynamic admin API with query params
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const GET = withSuperAdmin(async (request, context) => {
  try {
    logger.info({ route: '/api/admin/organizations', method: 'GET' }, 'Request received');
    logger.info({ userId: context.user.id, method: 'GET' }, 'Session found');
    
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const pageSize = parseInt(url.searchParams.get('pageSize') || '20', 10);
    const statusRaw = url.searchParams.get('status');
    const validStatuses = ['PENDING', 'ACTIVE', 'SUSPENDED', 'ARCHIVED'];
    const status = (statusRaw && validStatuses.includes(statusRaw)) ? statusRaw as 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED' : undefined;
    const search = url.searchParams.get('search') || undefined;
    
    const data = await OrganizationService.getPaginatedOrganizations({ page, pageSize, status, search });
    
    logger.info({ count: data.organizations.length, total: data.pagination.total, method: 'GET', statusFilter: status || 'all' }, 'Found organizations');
    
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
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

    try {
      const organization = await OrganizationService.createOrganization({ 
        name, 
        slug, 
        adminEmail 
      });

      logger.info({ orgId: organization.id, method: 'POST' }, 'Organization created');
      return NextResponse.json({ 
        message: 'Organization created successfully', 
        organization 
      }, { status: 201 });

    } catch (serviceError: unknown) {
      // Handle business logic errors thrown by the service
      if (serviceError instanceof Error && 
          (serviceError.message === 'An organization with this name already exists' || 
           serviceError.message === 'Unable to generate unique slug')) {
        return NextResponse.json({ error: serviceError.message }, { status: 400 });
      }
      throw serviceError; // Re-throw unknown errors to the outer catch block
    }
    
  } catch (error) {
    logger.error({ err: error, route: '/api/admin/organizations', method: 'POST' }, 'Unexpected error in POST handler');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
