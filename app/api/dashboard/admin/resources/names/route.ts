import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import globalDb from '@/lib/global-db';

export const runtime = 'nodejs';

/**
 * GET /api/dashboard/admin/resources/names
 * Returns a sorted list of all resource names. Used by the permissions page
 * to populate its "Filter by Resource" dropdown directly from the resource catalog.
 */
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const resources = await globalDb.resource.findMany({
      select: { name: true },
      orderBy: { name: 'asc' },
    });

    const names = resources.map((r) => r.name);
    return NextResponse.json({ names });
  } catch (error) {
    console.error('Failed to fetch resource names:', error);
    return NextResponse.json({ error: 'Failed to fetch resource names' }, { status: 500 });
  }
}
