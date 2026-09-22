/**
 * Startup health check — runs BEFORE the Next.js server starts.
 * Verifies that core services (PostgreSQL, Redis, PgBouncer) are up and sends
 * SSE notifications for each subsystem status.
 */

import tenantDb from '@/lib/tenant-db';
// RLS Phase 3: pre-server bootstrap has no session — bind the env platform org
// (withPlatformContextForDB) instead of the deleted unscoped client.
import { withPlatformContextForDB } from '@/lib/rls-transaction';
import { getRedis } from '@/lib/redis';
import { env } from '@/lib/env';
import { notifyHealthCheck } from '@/lib/notification-push';
import { addSystemLog, updateHealthState } from '@/lib/system-logs';
import { PgBouncerMonitor } from '@/lib/pgbouncer-monitor';

/** Resolve the platform organization ID at runtime. */
async function getPlatformOrgId(): Promise<string | null> {
  if (env.PLATFORM_ORGANIZATION_ID) return env.PLATFORM_ORGANIZATION_ID;
  try {
    // Fallback lookup needs a flag-carrying binding to be visible under RLS;
    // we bind with the slug as org scope — Organization admits platform flag.
    const org = await withPlatformContextForDB('platform', () =>
      tenantDb.organization.findFirst({ where: { slug: 'platform' }, select: { id: true } }),
    );
    return org?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * One-time startup health check — runs before the server accepts requests.
 * Notifies SSE for both UP and DOWN states so admins know what's running on boot.
 */
export async function performStartupHealthCheck(): Promise<void> {
  console.log('[startup-health] Performing startup health check...');

  const platformOrgId = await getPlatformOrgId();
  let dbStatus: 'healthy' | 'unhealthy' = 'healthy';
  let cacheStatus: 'healthy' | 'unhealthy' | null = null;
  let pgbouncerStatus: 'healthy' | 'unhealthy' | null = null;

  // Check PostgreSQL
  try {
    await tenantDb.$queryRaw`SELECT 1`;
    dbStatus = 'healthy';
    console.log('[startup-health] PostgreSQL: healthy');
    addSystemLog({
      level: 'info',
      source: 'health-check:database',
      message: 'Startup health check — database connectivity OK',
    });
    await notifyHealthCheck('database', true, platformOrgId);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    dbStatus = 'unhealthy';
    console.error('[startup-health] PostgreSQL: DOWN —', errorMessage);
    addSystemLog({
      level: 'error',
      source: 'health-check:database',
      message: 'Startup health check — database connectivity failed',
      details: errorMessage,
    });
    await notifyHealthCheck('database', false, platformOrgId);
  }

  // Check Redis (non-critical)
  try {
    const redisClient = getRedis();
    if (redisClient && redisClient.status !== 'end' && redisClient.status !== 'close') {
      await Promise.race([
        redisClient.ping(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Ping timeout after 2s')), 2000)),
      ]);
      cacheStatus = 'healthy';
      console.log('[startup-health] Redis: healthy');
      addSystemLog({
        level: 'info',
        source: 'health-check:cache',
        message: 'Startup health check — cache connectivity OK',
      });
      await notifyHealthCheck('cache', true, platformOrgId);
    } else {
      cacheStatus = 'unhealthy';
      console.error('[startup-health] Redis: DOWN — client not available');
      addSystemLog({
        level: 'error',
        source: 'health-check:cache',
        message: 'Startup health check — cache not configured or unavailable',
      });
      await notifyHealthCheck('cache', false, platformOrgId);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    cacheStatus = 'unhealthy';
    console.error('[startup-health] Redis: DOWN —', errorMessage);
    addSystemLog({
      level: 'error',
      source: 'health-check:cache',
      message: 'Startup health check — cache connection failed',
      details: errorMessage,
    });
    await notifyHealthCheck('cache', false, platformOrgId);
  }

  // Check PgBouncer (non-critical)
  try {
    const pgbouncer = new PgBouncerMonitor({
      host: process.env.PGBOUNCER_HOST || 'localhost',
      port: parseInt(process.env.PGBOUNCER_PORT || '6432'),
      user: process.env.PGBOUNCER_USER || 'pgbouncer',
      password: process.env.PGBOUNCER_PASSWORD || '',
    });

    await pgbouncer.connect();
    const health = await pgbouncer.checkHealth();

    if (health.isHealthy) {
      pgbouncerStatus = 'healthy';
      console.log('[startup-health] PgBouncer: healthy');
      addSystemLog({
        level: 'info',
        source: 'health-check:pgbouncer',
        message: 'Startup health check — connection pool connectivity OK',
      });
      await notifyHealthCheck('pgbouncer', true, platformOrgId);
    } else {
      pgbouncerStatus = 'unhealthy';
      console.error('[startup-health] PgBouncer: DOWN — health check failed');
      addSystemLog({
        level: 'error',
        source: 'health-check:pgbouncer',
        message: 'Startup health check — connection pool unavailable',
      });
      await notifyHealthCheck('pgbouncer', false, platformOrgId);
    }

    // Always disconnect after startup check to avoid holding connections
    await pgbouncer.disconnect();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    pgbouncerStatus = 'unhealthy';
    console.error('[startup-health] PgBouncer: DOWN —', errorMessage);
    addSystemLog({
      level: 'error',
      source: 'health-check:pgbouncer',
      message: 'Startup health check — connection pool connection failed',
      details: errorMessage,
    });
    await notifyHealthCheck('pgbouncer', false, platformOrgId);
  }

  // Update the tracked health state so subsequent /api/health checks can detect transitions
  updateHealthState(dbStatus, cacheStatus || 'healthy', pgbouncerStatus || undefined);

  console.log('[startup-health] Startup health check complete');
}

// Run startup health check if this script is executed directly (not imported)
if (require.main === module) {
  performStartupHealthCheck().catch((err) => {
    console.error('[startup-health] Startup health check failed:', err);
  });
}
