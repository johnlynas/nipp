/**
 * Health check logic — pure checks (no notifications).
 * Used by /api/health and the background task.
 */

import tenantDb from '@/lib/tenant-db';
import { getRedis } from '@/lib/redis';
import { addSystemLog, getPreviousHealthState, updateHealthState } from '@/lib/system-logs';
import { PgBouncerMonitor } from '@/lib/pgbouncer-monitor';

export type HealthCheckResult = Record<string, {
  status: string;
  latency_ms?: number;
  error?: string;
  message?: string;
  total_connections?: number;
}>;

export interface HealthResponse {
  status: string;
  timestamp: string;
  uptime: number;
  checks: HealthCheckResult;
}

/**
 * Run health checks for all services — returns current state only.
 * No notifications, no SSE pushes. Updates the tracked health state
 * so background checks can detect transitions on next tick.
 */
export async function checkHealthStatus(): Promise<HealthResponse> {
  const checks: HealthCheckResult = {};
  let overallStatus = 'healthy';

  const prevState = getPreviousHealthState();

  // --- Database Check (Critical) ---
  try {
    const dbStart = Date.now();
    await tenantDb.$queryRaw`SELECT 1`;
    checks.database = { status: 'healthy', latency_ms: Date.now() - dbStart };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    checks.database = { status: 'unhealthy', error: 'Database connection failed' };
    overallStatus = 'unhealthy';
  }

  // --- Cache Check (Non-critical) ---
  try {
    const redisClient = getRedis();
    if (redisClient) {
      if (redisClient.status === 'end' || redisClient.status === 'close') {
        console.log('[Redis] Connection closed, attempting reconnect...');
        redisClient.connect().catch(() => {});
        throw new Error('Redis client was closed, attempting reconnect');
      }

      const cacheStart = Date.now();
      await Promise.race([
        redisClient.ping(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Ping timeout after 2s')), 2000)),
      ]);

      checks.cache = { status: 'healthy', latency_ms: Date.now() - cacheStart };
    } else {
      checks.cache = { status: 'skipped', message: 'Cache not configured' };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    checks.cache = { status: 'unhealthy', error: `Cache connection failed (${errorMessage})` };
    if (overallStatus === 'healthy') overallStatus = 'degraded';
  }

  // --- PgBouncer Check (Critical) ---
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

    await pgbouncer.disconnect();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    checks["connection-pool"] = { status: 'unhealthy', error: 'Connection pool connection failed' };
    overallStatus = 'unhealthy';
  }

  // Update tracked state for next check (background task uses this to detect transitions)
  updateHealthState(
    (checks.database?.status || 'unhealthy') as 'healthy' | 'unhealthy',
    (checks.cache?.status || 'unhealthy') as 'healthy' | 'unhealthy',
    (checks["connection-pool"]?.status) as 'healthy' | 'unhealthy',
  );

  // Log overall status changes (for monitoring, not notifications)
  if (overallStatus === 'unhealthy') {
    console.error(`[HEALTH_CHECK_FAILED] Status: ${overallStatus} | Checks: ${JSON.stringify(checks)}`);
  } else if (overallStatus === 'degraded') {
    console.warn(`[HEALTH_CHECK_DEGRADED] Status: ${overallStatus} | Checks: ${JSON.stringify(checks)}`);
  }

  return {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    checks,
  };
}
