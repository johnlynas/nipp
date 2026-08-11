import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import globalDb from '@/lib/global-db';

export const runtime = 'nodejs';

/**
 * POST /api/dashboard/admin/users/[id]/ban
 * Toggle user ban status.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const id = (await params).id;
    const body = await request.json();

    const user = await globalDb.user.findUnique({ where: { id } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const banned = body.banned ?? !user.banned;
    const updatedUser = await globalDb.user.update({
      where: { id },
      data: {
        banned,
        banReason: body.banReason ?? (banned ? 'Banned via dashboard' : null),
        banExpires: body.banExpires ?? (banned ? null : undefined),
      },
    });

    return NextResponse.json(updatedUser);
  } catch (error) {
    console.error('Failed to toggle user ban:', error);
    return NextResponse.json({ error: 'Failed to update user ban status' }, { status: 500 });
  }
}
