import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

// RLS Phase 3: organization listing/creation run under a verified platform context.
import { withPlatformContext } from '@/lib/platform-db';
import { OrganizationService } from '@/services/organization-service';
import { notifyOrganizationOperation } from '@/lib/notification-push';

export const runtime = 'nodejs';

/**
 * GET /api/dashboard/admin/organizations
 * List organizations with pagination, search, and status filter.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const pageSize = parseInt(url.searchParams.get('pageSize') || '20', 10);
    const status = url.searchParams.get('status') as 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED' | undefined;
    const search = url.searchParams.get('search') || undefined;

    // One verified platform context for the whole cross-org listing.
    return await withPlatformContext(auth.session!.user.id, async () => {
      const result = await OrganizationService.getPaginatedOrganizations({ page, pageSize, status, search });
      return NextResponse.json(result);
    });
  } catch (error) {
    console.error('Failed to list organizations:', error);
    return NextResponse.json({ error: 'Failed to fetch organizations' }, { status: 500 });
  }
}

/**
 * POST /api/dashboard/admin/organizations
 * Create a new organization.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Rate limit write operations by session
  if (!checkAdminRateLimit(auth.session!.user.id)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  let body: { name?: string; slug?: string; description?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const targetLabel = body.name ? `Organization "${body.name}"` : 'organization';

  // Narrowed once so the platform-context closure below keeps a plain string.
  const orgName = body.name;
  if (!orgName) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }

  try {
    // Verified platform context: Organization INSERT policy checks the admin flag.
    const result = await withPlatformContext(auth.session!.user.id, () =>
      OrganizationService.createOrganization(
        { name: orgName, slug: body.slug, description: body.description },
        {
          userId: auth.session!.user.id,
          role: 'PLATFORM_ADMIN',
        }
      )
    );

    await notifyOrganizationOperation('create', targetLabel, true, undefined, result.id);

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'An organization with this name already exists') {
      await notifyOrganizationOperation('create', targetLabel, false, error.message);
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error('Failed to create organization:', error);
    const message = error instanceof Error && error.message ? error.message : 'Failed to create organization';
    await notifyOrganizationOperation('create', targetLabel, false, message);
    return NextResponse.json({ error: 'Failed to create organization' }, { status: 500 });
  }
}
