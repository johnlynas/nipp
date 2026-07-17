// Example usage in system-logs/route.ts
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

export async function GET() {
  try {
    const { authorized, error, status, session } = await requireSuperAdmin();
    
    if (!authorized) {
      return NextResponse.json({ error }, { status });
    }

    logger.info({ userId: session.user.id }, 'System logs accessed by super admin');
    // ... proceed with fetching logs ...
  } catch (error) {
    logger.error({ err: error }, 'Unexpected error in system-logs GET');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}