/**
 * GET /api/auth/user-permissions
 *
 * Returns the current user's flattened permission list as JSON.
 * Used by React Query hooks (usePermissions) to avoid redundant session lookups.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      return NextResponse.json([], { status: 200 });
    }

    // Return the permissions array from session.user.permissions
    const user = session.user as any;
    return NextResponse.json(user.permissions || []);
  } catch (_error) {
    // Return empty array on error — React Query will retry with exponential backoff
    return NextResponse.json([], { status: 200 });
  }
}
