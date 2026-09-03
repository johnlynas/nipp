import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

import globalDb from '@/lib/global-db';
import { logger } from '@/lib/logger';

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
    if (!checkAdminRateLimit(auth.session!.user.id)) {
    return NextResponse.json({'error': 'rate_limited'}, {status: 429});
  }

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

    logger.info(
      { adminUserId: auth.session!.user.id, targetUserId: id, banned, banReason: updatedUser.banReason },
      `User ${banned ? 'banned' : 'unbanned'} by admin`,
    );

    return NextResponse.json(updatedUser);
  } catch (error) {
    logger.error({ err: error, adminUserId: auth.session!.user.id }, 'Failed to toggle user ban');
    return NextResponse.json({ error: 'Failed to update user ban status' }, { status: 500 });
  }
}
