/**
 * GET /api/roles/permissions
 *
 * List all available permissions from the master catalog.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import prisma from '@/lib/db';

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const permissions = await prisma.permission.findMany({
    select: { key: true, resource: true, action: true, description: true },
    orderBy: { resource: 'asc' },
  });

  return NextResponse.json({ permissions });
}
