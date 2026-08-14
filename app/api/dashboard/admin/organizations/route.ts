import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { OrganizationService } from '@/services/organization-service';

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

    const result = await OrganizationService.getPaginatedOrganizations({ page, pageSize, status, search });

    return NextResponse.json(result);
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

  try {
    const body = await request.json();
    const result = await OrganizationService.createOrganization(body, {
      userId: auth.session!.user.id,
      role: 'PLATFORM_ADMIN',
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'An organization with this name already exists') {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error('Failed to create organization:', error);
    return NextResponse.json({ error: 'Failed to create organization' }, { status: 500 });
  }
}
