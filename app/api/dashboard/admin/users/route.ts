import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { UserService } from '@/services/user-service';

export const runtime = 'nodejs';

/**
 * GET /api/dashboard/admin/users
 * List users with pagination, search, and filters.
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
    const search = url.searchParams.get('search') || undefined;
    const role = url.searchParams.get('role') || undefined;
    const organizationId = url.searchParams.get('organizationId') || undefined;
    const teamId = url.searchParams.get('teamId') || undefined;

    const result = await UserService.list(
      { search, role, organizationId, teamId },
      { page, pageSize },
      { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' }
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to list users:', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}

/**
 * POST /api/dashboard/admin/users
 * Create a new user.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = await request.json();
    const result = await UserService.create(body, {
      userId: auth.session!.user.id,
      role: 'PLATFORM_ADMIN',
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'A user with this email already exists') {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error('Failed to create user:', error);
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
  }
}
