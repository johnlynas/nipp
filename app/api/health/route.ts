import { prisma } from '@/lib/db';
import { getRedis, forceRedisReconnect } from '@/lib/redis';
import { addSystemLog, getPreviousHealthState, updateHealthState } from '@/lib/system-logs';
import { PgBouncerMonitor } from '@/lib/pgbouncer-monitor';
import { NextResponse } from 'next/server';

export async function GET() {
  const checks: Record<string, any> = {};
  let overallStatus = 'healthy';

  // Get previous state
  const prevState = getPreviousHealthState();

  // Database Check (Critical)
  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: 'healthy', latency_ms: Date.now() - dbStart };
    
    // Log recovery if it was previously down
    if (prevState.database === 'unhealthy') {
      addSystemLog({
        level: 'info',
        source: 'health-check:database',
        message: 'Database connectivity restored',
        details: `Database is now healthy (latency: ${checks.database.latency_ms}ms)`,
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    checks.database = { status: 'unhealthy', error: 'Database connection failed' };
    overallStatus = 'unhealthy';
    
    // Only log if state changed from healthy to unhealthy
    if (prevState.database !== 'unhealthy') {
      addSystemLog({
        level: 'error',
        source: 'health-check:database',
        message: 'Database connectivity check failed',
        details: errorMessage,
      });
    }
  }

  // Cache Check (Non-critical, graceful degradation)
  try {
    const redisClient = getRedis();
    if (redisClient) {
      // If connection is closed, try to reconnect
      if (redisClient.status === 'end' || redisClient.status === 'closed') {
        console.log('[Redis] Connection closed, attempting reconnect...');
        redisClient.connect().catch(() => {});
        throw new Error('Redis client was closed, attempting reconnect');
      }
      
      const cacheStart = Date.now();
      
      // Use Promise.race to timeout the ping after 2 seconds
      const pingPromise = redisClient.ping();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Ping timeout after 2s')), 2000)
      );
      
      await Promise.race([pingPromise, timeoutPromise]);
      
      checks.cache = { status: 'healthy', latency_ms: Date.now() - cacheStart };
      
      // Log recovery if it was previously down
      if (prevState.cache === 'unhealthy') {
        addSystemLog({
          level: 'info',
          source: 'health-check:cache',
          message: 'Cache connectivity restored',
          details: `Cache is now healthy (latency: ${checks.cache.latency_ms}ms)`,
        });
      }
    } else {
      checks.cache = { status: 'skipped', message: 'Cache not configured' };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    checks.cache = { status: 'unhealthy', error: `Cache connection failed (${errorMessage})` };
    if (overallStatus === 'healthy') {
      overallStatus = 'degraded';
    }
    
    // Only log if state changed from healthy to unhealthy
    if (prevState.cache !== 'unhealthy') {
      addSystemLog({
        level: 'error',
        source: 'health-check:cache',
        message: 'Cache connectivity check failed',
        details: errorMessage,
      });
    }
  }

  // PgBouncer Check (Critical)
  try {
    const pgbouncer = new PgBouncerMonitor({
      host: process.env.PGBOUNCER_HOST || 'localhost',
      port: parseInt(process.env.PGBOUNCER_PORT || '6432'),
      user: process.env.PGBOUNCER_USER || 'pgbouncer',
      password: process.env.PGBOUNCER_PASSWORD || '',
    });

    const pgbouncerStart = Date.now();
    await pgbouncer.connect();
    const health = await pgbouncer.checkHealth();
    checks["connection-pool"] = { 
      status: health.isHealthy ? 'healthy' : 'unhealthy', 
      latency_ms: Date.now() - pgbouncerStart,
      total_connections: health.totalConnections,
    };

    if (prevState["connection-pool"] === 'unhealthy') {
      addSystemLog({
        level: 'info',
        source: 'health-check:pgbouncer',
        message: 'Connection pool connectivity restored',
        details: `Connection pool is now healthy (latency: ${checks["connection-pool"].latency_ms}ms)`,
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    checks["connection-pool"] = { status: 'unhealthy', error: 'Connection pool connection failed' };
    overallStatus = 'unhealthy';

    if (prevState["connection-pool"] !== 'unhealthy') {
      addSystemLog({
        level: 'error',
        source: 'health-check:pgbouncer',
        message: 'Connection pool connectivity check failed',
        details: errorMessage,
      });
    }
  }

  // Update the tracked state
  updateHealthState(
    checks.database.status as 'healthy' | 'unhealthy',
    checks.cache.status as 'healthy' | 'unhealthy',
    (checks["connection-pool"]?.status) as 'healthy' | 'unhealthy'
  );

  const statusCode = overallStatus === 'unhealthy' ? 503 : 200;

  // Structured logging for monitoring and admin follow-up
  if (overallStatus === 'unhealthy') {
    console.error(`[HEALTH_CHECK_FAILED] Status: ${overallStatus} | Checks: ${JSON.stringify(checks)}`);
  } else if (overallStatus === 'degraded') {
    console.warn(`[HEALTH_CHECK_DEGRADED] Status: ${overallStatus} | Checks: ${JSON.stringify(checks)}`);
  }

  return NextResponse.json(
    {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()), // Server uptime in seconds (useful for admins)
      checks,
    },
    { status: statusCode }
  );
}
