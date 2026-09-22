/**
 * Background health check — runs every 30 seconds to monitor services
 * and send SSE notifications ONLY when state changes.
 */

import { checkHealthStatus } from '@/lib/health-check';
import { getPreviousHealthState, addSystemLog } from '@/lib/system-logs';
import { notifyHealthCheck } from '@/lib/notification-push';
import tenantDb from '@/lib/tenant-db';
import { withEnvPlatformContext } from '@/lib/rls-transaction';
import { env } from '@/lib/env';
import { isMainThread } from 'node:worker_threads';

const HEALTH_CHECK_INTERVAL_MS = 30_000; // 30 seconds

/** Shared across all module instances (Next.js dev mode can load the same module twice). */
function getHealthCheckTimer(): ReturnType<typeof setInterval> | null {
  const g = globalThis as unknown as Record<string, ReturnType<typeof setInterval> | null>;
  return g.__nipp_healthCheckTimer ?? null;
}

function setHealthCheckTimer(timer: ReturnType<typeof setInterval> | null): void {
  const g = globalThis as unknown as Record<string, ReturnType<typeof setInterval> | null>;
  g.__nipp_healthCheckTimer = timer;
}

/**
 * Resolve the platform organization ID for notification attribution.
 *
 * RLS NOTE: outside a request there is no tenant context, and an UNBOUND
 * Organization SELECT would return zero rows under the non-owner app role —
 * so the DB fallback below only works when PLATFORM_ORGANIZATION_ID is unset
 * in unit-test setups, NOT live. Production must set the env var (the seed
 * guarantees a platform org); attribution to null is cosmetic (the row still
 * persists via the platform-admin RLS branch, which does not depend on it).
 */
async function getPlatformOrgId(): Promise<string | null> {
  if (env.PLATFORM_ORGANIZATION_ID) return env.PLATFORM_ORGANIZATION_ID;
  try {
    const org = await tenantDb.organization.findFirst({
      where: { slug: 'platform' },
      select: { id: true },
    });
    return org?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Run health checks and notify on state transitions.
 */
async function runHealthCheckWithNotifications(): Promise<void> {
  const platformOrgId = await getPlatformOrgId();

  // Capture a SNAPSHOT of state BEFORE the health check runs
  const prevState = { ...getPreviousHealthState() };

  // Run health checks — this updates the tracked state internally (side effect)
  await checkHealthStatus();

  // Capture a SNAPSHOT of state AFTER the health check runs
  const nextState = { ...getPreviousHealthState() };

  const services: Array<{ key: 'database' | 'cache' | 'pgbouncer', label: string, source: string }> = [
    { key: 'database', label: 'Database', source: 'health-check:database' },
    { key: 'cache', label: 'Cache', source: 'health-check:cache' },
    { key: 'pgbouncer', label: 'Connection pool', source: 'health-check:pgbouncer' },
  ];

  // Check each service for transitions (prev !== next means a change occurred).
  // RLS: the Notification INSERTs run OUT-OF-REQUEST (no tenant context), so the
  // platform-admin GUCs must be bound, or the non-owner app role's
  // rls_notification_insert denies them (42501 — observed live). Binding is env
  // sourced; a null attribution (env unset / lookup miss) still persists fine
  // because the INSERT policy's platform branch does not depend on org.
  await withEnvPlatformContext(async () => {
    for (const { key, label, source } of services) {
      const prevValue = prevState[key];
      const nextValue = nextState[key];

      // Only notify on actual transitions (prev !== next)
      if (prevValue === null || prevValue !== nextValue) {
        const isUp = nextValue === 'healthy';

        // Log to system logs
        addSystemLog({
          level: isUp ? 'info' : 'error',
          source,
          message: prevValue === null
            ? `${label} health check — initial state ${isUp ? 'healthy' : 'unhealthy'}`
            : isUp
              ? `${label} connectivity restored`
              : `${label} connectivity check failed`,
          details: `${label} is now ${isUp ? 'healthy' : 'unreachable'}`,
        });

        // Send SSE notification (only on transitions)
        await notifyHealthCheck(key as 'database' | 'cache' | 'pgbouncer', isUp, platformOrgId);

        console.log(`[background-health-check] ${label} transitioned: ${prevValue ?? 'null'} → ${nextValue}`);
      } else {
        console.log(`[background-health-check] ${label} no change: ${prevValue}`);
      }
    }
  });
}

/** Start the background health check interval. Safe to call multiple times (idempotent). */
export function startBackgroundHealthCheck(): void {
  if (getHealthCheckTimer()) return; // Already running

  const timer = setInterval(async () => {
    try {
      await runHealthCheckWithNotifications();
    } catch (error) {
      console.error('[background-health-check] Error running health check:', error);
    }
  }, HEALTH_CHECK_INTERVAL_MS);

  setHealthCheckTimer(timer);

  // Also run immediately on startup (after server is ready)
  runHealthCheckWithNotifications().catch((err) => {
    console.error('[background-health-check] Initial health check failed:', err);
  });

  if (typeof timer.unref === 'function') {
    timer.unref(); // Don't prevent process exit in dev mode
  }

  console.log(`[background-health-check] Started (every ${HEALTH_CHECK_INTERVAL_MS / 1000}s)`);
}

/** Stop the background health check interval (useful for tests). */
export function stopBackgroundHealthCheck(): void {
  const timer = getHealthCheckTimer();
  if (timer) {
    clearInterval(timer);
    setHealthCheckTimer(null);
  }
}

// Start on module load — this runs once when Next.js server starts. Guarded
// to the main thread: Bree job-scheduler workers import this transitively via
// the built-in handler set, and a per-fork health interval would double every
// 30 s check (each worker sees a "fresh" globalThis singleton).
if (isMainThread) {
  startBackgroundHealthCheck();
}
