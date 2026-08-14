import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * POST /api/dashboard/admin/errors
 * Client-side error logging endpoint. Logs client errors with pino for server-side observability.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = await request.json();
    const { message, page, action } = body;

    logger.error(
      { userId: auth.session!.user.id, message, page, action },
      `Client error on ${page}: ${message}`,
    );

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to log error' }, { status: 500 });
  }
}
