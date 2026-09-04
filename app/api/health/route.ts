import { NextResponse } from 'next/server';
import { checkHealthStatus } from '@/lib/health-check';

export async function GET() {
  const health = await checkHealthStatus();

  const statusCode = health.status === 'unhealthy' ? 503 : 200;

  return NextResponse.json(health, { status: statusCode });
}
