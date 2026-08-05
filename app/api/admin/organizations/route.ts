import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { OrganizationService } from '@/services/organization-service';
import { ServiceContext } from '@/lib/services/types';
import { recordAuditLog } from '@/lib/audit-log';
import { logger } from '@/lib/logger';
import { wrapPiiRoute } from '@/lib/payload-middleware';

// Disable Next.js ISR caching — this is a dynamic admin API with query params
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ---------------------------------------------------------------------------
// GET — List organizations (paginated)
// ---------------------------------------------------------------------------

export const GET = wrapPiiRoute(async (request) => {
  // decryptedBody is null for GET requests

  const authResult = await requireSuperAdmin(request.headers);
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
  }

  try {
    logger.info({ route: '/api/admin/organizations', method: 'GET' }, 'Request received');

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

// ---------------------------------------------------------------------------
// POST — Create organization
// ---------------------------------------------------------------------------

export const POST = wrapPiiRoute(async (request, decryptedBody) => {
  const authResult = await requireSuperAdmin(request.headers);
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
  }

  const session = authResult.session!;

  try {
    logger.info({ route: '/api/admin/organizations', method: 'POST' }, 'Request received');

    // Use decryptedBody (already parsed JSON) or fall back to request.json()
    let body: { name?: string; slug?: string; adminEmail?: string };
    if (decryptedBody && typeof decryptedBody === 'object') {
      body = decryptedBody as { name?: string; slug?: string; adminEmail?: string };
    } else {
      // decryptedBody is null when encryption mode is 'disabled'.
      // In that case the body should be plaintext JSON — but if the client
      // sent an encrypted payload anyway, give a clear error instead of a
      // confusing JSON parse failure.
      const contentType = request.headers.get('Content-Type') || '';
      if (contentType.includes('application/octet-stream')) {
        logger.warn({ method: 'POST' }, 'Received encrypted body but encryption mode is disabled');
        return NextResponse.json(
          { error: 'Payload encryption is enabled on the client but disabled on the server. Set PAYLOAD_ENCRYPTION_MODE=permissive or enforce.' },
          { status: 400 },
        );
      }
      try {
        body = await request.json();
        logger.debug({ method: 'POST' }, 'Request body parsed');
      } catch (parseError) {
        logger.error({ err: parseError, method: 'POST' }, 'Failed to parse request body');
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
      }
    }

    const { name, slug, adminEmail } = body;
    if (!name) {
      return NextResponse.json({ error: 'Organization name is required' }, { status: 400 });
    }

    try {
      const ctx: ServiceContext = {
        userId: session.user.id,
        role: 'PLATFORM_ADMIN',
      };
      const organization = await OrganizationService.createOrganization({ name, slug, adminEmail }, ctx);

      logger.info({ orgId: organization.id, method: 'POST' }, 'Organization created');

      // Record audit log for organization creation
      await recordAuditLog({
        userId: session.user.id,
        userName: (session.user as { name?: string }).name ?? undefined,
        action: 'organization.created',
        resourceType: 'Organization',
        resourceId: organization.id,
        success: true,
      }).catch((err) => logger.error({ err }, 'Failed to record audit log for org creation'));

      return NextResponse.json({
        message: 'Organization created successfully',
        organization,
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
