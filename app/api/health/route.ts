import { prisma } from '@/lib/db';
import { getRedis } from '@/lib/redis';
import { NextResponse } from 'next/server';

export async function GET() {
  const checks: Record<string, any> = {};
  let overallStatus = 'healthy';

  // Database Check (Critical)
  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: 'healthy', latency_ms: Date.now() - dbStart };
  } catch (error) {
    checks.database = { status: 'unhealthy', error: 'Database connection failed' };
    overallStatus = 'unhealthy';
  }

  // Cache Check (Non-critical, graceful degradation)
  try {
    const redisClient = getRedis();
    if (redisClient) {
      const cacheStart = Date.now();
      await redisClient.ping();
      checks.cache = { status: 'healthy', latency_ms: Date.now() - cacheStart };
    } else {
      checks.cache = { status: 'skipped', message: 'Cache not configured' };
    }
  } catch (error) {
    checks.cache = { status: 'unhealthy', error: 'Cache connection failed' };
    if (overallStatus === 'healthy') {
      overallStatus = 'degraded';
    }
  }

  const statusCode = overallStatus === 'unhealthy' ? 503 : 200;

  return NextResponse.json(
    {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '0.1.0',
      uptime: Math.floor(process.uptime()), // Server uptime in seconds
      checks,
    },
    { status: statusCode }
  );
}
