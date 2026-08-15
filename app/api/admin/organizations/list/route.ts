import { NextResponse } from 'next/server';
import globalDb from '@/lib/global-db';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { headers as nextHeaders } from 'next/headers';

// Disable caching — this is a dynamic admin API
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/admin/organizations/list
 * Returns a list of all organizations (excluding platform) for the org switcher.
 */
export async function GET() {
  try {
    const authResult = await requireSuperAdmin(await nextHeaders());
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
    }

    const organizations = await globalDb.organization.findMany({
      where: {
        slug: { not: 'platform' },
      },
      select: {
        id: true,
        name: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    return NextResponse.json({ organizations });
  } catch (error) {
    console.error('Error fetching organizations list:', error);
    return NextResponse.json({ error: 'Failed to fetch organizations' }, { status: 500 });
  }
}
