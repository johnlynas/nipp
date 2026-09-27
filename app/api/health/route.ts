/**
 * GET /api/health          -- liveness/readiness probe (200 healthy, 503 unhealthy)
 *
 * Public — no authentication required; excluded from the auth middleware.
 */

import { NextResponse } from 'next/server';
import { checkHealthStatus } from '@/lib/health-check';

export async function GET() {
  const health = await checkHealthStatus();

  const statusCode = health.status === 'unhealthy' ? 503 : 200;

  return NextResponse.json(health, { status: statusCode });
}
