/**
 * Health check logic — pure checks (no notifications).
 * Used by /api/health and the background task.
 */

import tenantDb from '@/lib/tenant-db';
import { getRedis } from '@/lib/redis';
import { updateHealthState } from '@/lib/system-logs';
import { PgBouncerMonitor } from '@/lib/pgbouncer-monitor';
import { env } from '@/lib/env';

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

const REMOTE_HEALTH_TIMEOUT_MS = 5000;

/** Shape of the JSON body both remote health endpoints (MCP, AI agent) return. */
interface RemoteHealthBody {
  status?: 'healthy' | 'degraded' | 'unhealthy';
  checks?: Record<string, { status?: string; error?: string; message?: string }>;
}

/** Extract the failing dependency details from a remote health body, if any. */
function summarizeRemoteChecks(body: RemoteHealthBody): string | undefined {
  const failed = Object.entries(body.checks ?? {})
    .filter(([, c]) => c.status === 'unhealthy')
    .map(([name, c]) => `${name}${c.error ? `: ${c.error}` : ''}`);
  return failed.length > 0 ? failed.join('; ') : undefined;
}

/**
 * Probe a remote health endpoint (MCP server, AI agent server).
 *
 * Both endpoints answer with JSON `{ status: 'healthy' | 'degraded' | 'unhealthy', checks }`
 * and HTTP 200 for healthy/degraded, 503 for unhealthy. The service is reported
 * `healthy` (up) on `status: 'healthy'` or `'degraded'` — degraded means the process
 * is answering with some dependency down (amber at the source, not red). Any other
 * outcome (timeout, network error, non-2xx, malformed body, missing status) is
 * reported as `unhealthy` with the reason in `error`.
 */
export async function checkRemoteService(url: string): Promise<HealthCheckResult[string]> {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(REMOTE_HEALTH_TIMEOUT_MS),
      cache: 'no-store',
    });
    const latency = Date.now() - start;

    let body: RemoteHealthBody | undefined;
    try {
      body = (await res.json()) as RemoteHealthBody;
    } catch {
      // Non-JSON body — fall through to the HTTP-status decision below.
    }

    if (!res.ok) {
      const detail = summarizeRemoteChecks(body ?? {});
      return {
        status: 'unhealthy',
        latency_ms: latency,
        error: `HTTP ${res.status}${detail ? ` — ${detail}` : ''}`,
      };
    }

    if (!body || typeof body !== 'object' || !('status' in body)) {
      return { status: 'unhealthy', latency_ms: latency, error: 'Invalid JSON response (no status field)' };
    }

    const status = body.status;
    if (status === 'healthy') {
      return { status: 'healthy', latency_ms: latency };
    }
    if (status === 'degraded') {
      // Process is up and answering — amber at the source, not red here.
      return {
        status: 'healthy',
        latency_ms: latency,
        message: `Service degraded${summarizeRemoteChecks(body) ? ` (${summarizeRemoteChecks(body)})` : ''}`,
      };
    }
    const detail = summarizeRemoteChecks(body);
    return {
      status: 'unhealthy',
      latency_ms: latency,
      error: `Service reported "${String(status ?? 'unknown')}"${detail ? ` — ${detail}` : ''}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'unhealthy', latency_ms: Date.now() - start, error: `Request failed (${message})` };
  }
}

/**
 * Run health checks for all services — returns current state only.
 * No notifications, no SSE pushes. Updates the tracked health state
 * so background checks can detect transitions on next tick.
 */
export async function checkHealthStatus(): Promise<HealthResponse> {
  const checks: HealthCheckResult = {};
  let overallStatus = 'healthy';

  // --- Database Check (Critical) ---
  try {
    const dbStart = Date.now();
    await tenantDb.$queryRaw`SELECT 1`;
    checks.database = { status: 'healthy', latency_ms: Date.now() - dbStart };
  } catch {
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
    checks["connection-pool"] = { status: 'unhealthy', error: `Connection pool connection failed (${error instanceof Error ? error.message : String(error)})` };
    overallStatus = 'unhealthy';
  }

  // --- Remote Service Check (Non-critical) — MCP server ---
  // The portal keeps running without the MCP server, so a failure degrades
  // overall status to 'degraded' (amber), never 'unhealthy'.
  checks.mcp = await checkRemoteService(env.MCP_HEALTH_URL);

  // --- Remote Service Check (Non-critical) — AI agent server ---
  // Depends on MCP + portal; same amber severity as above.
  checks.ai_agent = await checkRemoteService(env.AI_AGENT_HEALTH_URL);

  // Non-critical services degrade (amber) but never take the system red.
  if (overallStatus === 'healthy' && (checks.mcp?.status !== 'healthy' || checks.ai_agent?.status !== 'healthy')) {
    overallStatus = 'degraded';
  }

  // Update tracked state for next check (background task uses this to detect transitions)
  updateHealthState(
    (checks.database?.status || 'unhealthy') as 'healthy' | 'unhealthy',
    (checks.cache?.status || 'unhealthy') as 'healthy' | 'unhealthy',
    (checks["connection-pool"]?.status) as 'healthy' | 'unhealthy',
    (checks.mcp?.status || 'unhealthy') as 'healthy' | 'unhealthy',
    (checks.ai_agent?.status || 'unhealthy') as 'healthy' | 'unhealthy',
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
