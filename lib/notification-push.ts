/**
 * Notification Push Service — SSE broadcast layer.
 *
 * Acts as a pub/sub bridge between internal events (health checks, admin messages)
 * and connected SSE clients. Tracks active connections with caps per user and global.
 *
 * Connection management:
 *   - Per-user cap: max 3 concurrent SSE connections per session (prevents tab-doubling)
 *   - Global cap: max 500 total concurrent SSE connections (prevents DoS)
 *   - Automatic cleanup on disconnect via AbortController signal
 *
 * Notification scoping:
 *   - ORG: only delivered to subscribers in the specified organization
 *   - GLOBAL: delivered to all active subscribers (super admins + all tenants)
 */

import { NotificationPriority, NotificationScope } from '@prisma/client';
import globalDb from '@/lib/global-db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NotificationPayload {
  id: string;
  title: string;
  message: string;
  priority: NotificationPriority;
  scope: NotificationScope;
  source?: string | null;
  organizationId?: string | null;
  organizationName?: string | null;
  createdAt: string;
}

interface SseSubscriber {
  connectionId: string;
  sessionId: string;
  userId: string;
  orgId: string | null; // null for super admins who see everything
  writer: WritableStreamDefaultWriter<Uint8Array>;
  encoder: TextEncoder;
}

// ---------------------------------------------------------------------------
// Configuration — read from env with hardcoded defaults
// ---------------------------------------------------------------------------

const MAX_CONNECTIONS_PER_USER = Number(process.env.SSE_MAX_CONNECTIONS_PER_USER ?? 3);
const MAX_GLOBAL_CONNECTIONS = Number(process.env.SSE_MAX_GLOBAL_CONNECTIONS ?? 500);
const HEARTBEAT_INTERVAL_MS = Number(process.env.SSE_HEARTBEAT_INTERVAL ?? 15000); // 15s

// ---------------------------------------------------------------------------
// Connection tracking — in-memory store keyed by session ID
// ---------------------------------------------------------------------------

const activeSubscribers = new Map<string, SseSubscriber>();

/** Get count of active connections for a session. */
export function getSessionConnectionCount(sessionId: string): number {
  let count = 0;
  for (const sub of activeSubscribers.values()) {
    if (sub.sessionId === sessionId) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Public API — add/remove subscribers, push notifications
// ---------------------------------------------------------------------------

/**
 * Normalize a priority (which callers may pass as a lowercase string, e.g.
 * 'info' from the admin API) into a valid Prisma NotificationPriority member.
 * Falls back to INFO for anything unrecognized rather than persisting garbage.
 */
function normalizePriority(priority: string | NotificationPriority): NotificationPriority {
  const key = String(priority ?? '').toUpperCase();
  if (
    key === NotificationPriority.INFO ||
    key === NotificationPriority.WARNING ||
    key === NotificationPriority.ERROR ||
    key === NotificationPriority.CRITICAL
  ) {
    return key as NotificationPriority;
  }
  return NotificationPriority.INFO;
}

/**
 * Register a new SSE subscriber. Returns true if accepted, false if caps exceeded.
 */
export function addSubscriber(subscriber: SseSubscriber): boolean {
  // Check global cap first (cheap O(1) via size)
  if (activeSubscribers.size >= MAX_GLOBAL_CONNECTIONS) {
    console.warn(`[SSE] Global connection cap reached (${MAX_GLOBAL_CONNECTIONS})`);
    return false;
  }

  // Check per-user cap
  const userCount = getSessionConnectionCount(subscriber.sessionId);
  if (userCount >= MAX_CONNECTIONS_PER_USER) {
    console.warn(
      `[SSE] Per-user connection cap reached for session ${subscriber.sessionId} (${userCount}/${MAX_CONNECTIONS_PER_USER})`
    );
    return false;
  }

  activeSubscribers.set(subscriber.connectionId, subscriber);
  return true;
}

/**
 * Remove a subscriber when the connection is closed.
 */
export function removeSubscriber(connectionId: string): void {
  activeSubscribers.delete(connectionId);
}

/**
 * Get the number of currently connected subscribers.
 */
export function getSubscriberCount(): number {
  return activeSubscribers.size;
}

/**
 * Push a notification to all matching subscribers.
 * - ORG scope: delivered only to subscribers in the same org (or super admins with no orgId)
 * - GLOBAL scope: delivered to all subscribers
 */
export async function pushNotification(payload: Omit<NotificationPayload, 'id' | 'createdAt'>): Promise<void> {
  // Normalize priority to a canonical Prisma enum member so both persistence
  // and the wire payload carry 'INFO'|'WARNING'|... (callers may send 'info').
  const normalizedPriority = normalizePriority(payload.priority);

  // Resolve organization name for display (org-scoped notifications) so SSE
  // consumers don't need a second lookup. Best effort — missing name is fine.
  let organizationName: string | undefined;
  if (payload.organizationId) {
    const org = await globalDb.organization.findUnique({
      where: { id: payload.organizationId },
      select: { name: true },
    });
    organizationName = org?.name ?? undefined;
  }

  const notification: NotificationPayload = {
    ...payload,
    priority: normalizedPriority,
    organizationName,
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };

  console.log(`[SSE] pushNotification: ${notification.title} | priority=${notification.priority} scope=${notification.scope} source=${notification.source ?? 'none'} orgId=${notification.organizationId ?? 'none'}`);

  // Dedup: skip if an identical notification was persisted within the last
  // 10 seconds. This prevents duplicate DB rows when two concurrent requests
  // (e.g., frontend health polling + external monitor) both read the same
  // prevState and fire the same notify call.
  const dedupWindow = new Date(Date.now() - 10_000);
  const existing = await globalDb.notification.findFirst({
    where: {
      title: notification.title,
      message: notification.message,
      priority: normalizedPriority,
      scope: notification.scope,
      source: notification.source ?? null,
      organizationId: notification.organizationId ?? null,
      createdAt: { gte: dedupWindow },
    },
  });
  if (existing) {
    console.log(`[SSE] Dedup — skipping duplicate notification: ${notification.title}`);
    return;
  }

  // Persist to DB for history/replay (model has no organizationName column)
  try {
    await globalDb.notification.create({
      data: {
        title: notification.title,
        message: notification.message,
        priority: notification.priority,
        scope: notification.scope,
        source: notification.source ?? null,
        organizationId: notification.organizationId ?? null,
      },
    });
    console.log(`[SSE] Notification persisted: ${notification.id}`);
  } catch (err) {
    console.error('[SSE] Failed to persist notification:', err);
  }

  // Serialize once, broadcast to all matching subscribers
  const dataStr = JSON.stringify(notification);
  const message = `data: ${dataStr}\n\n`;

  let deliveredCount = 0;
  for (const [connectionId, sub] of activeSubscribers) {
    try {
      // Filter by scope:
      // - GLOBAL: deliver to everyone (including super admins with orgId=null)
      // - ORG: deliver only to subscribers in the same org or super admins (orgId=null)
      if (payload.scope === NotificationScope.GLOBAL) {
        await sub.writer.write(sub.encoder.encode(message));
        deliveredCount++;
      } else if (payload.scope === NotificationScope.ORG) {
        // Super admins (orgId=null) see all notifications; tenant users only see their own org's
        if (!sub.orgId || sub.orgId === payload.organizationId) {
          await sub.writer.write(sub.encoder.encode(message));
          deliveredCount++;
        }
      }
    } catch {
      // Subscriber disconnected — clean up silently
      removeSubscriber(connectionId);
    }
  }

  if (activeSubscribers.size === 0) {
    console.log(`[SSE] No active subscribers — notification ${notification.id} was persisted but not broadcast to SSE`);
  } else {
    console.log(`[SSE] Delivered notification ${notification.id} to ${deliveredCount}/${activeSubscribers.size} subscribers`);
  }
}

/**
 * Send a heartbeat ping to all active subscribers (prevents proxy timeouts).
 */
export async function sendHeartbeat(): Promise<void> {
  const message = ': heartbeat\n\n'; // SSE comment = heartbeat/ping

  for (const [connectionId, sub] of activeSubscribers) {
    try {
      await sub.writer.write(sub.encoder.encode(message));
    } catch {
      removeSubscriber(connectionId);
    }
  }
}

/**
 * Start the heartbeat interval. Safe to call multiple times (idempotent).
 */
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

export function startHeartbeat(): void {
  if (heartbeatTimer) return; // Already running

  heartbeatTimer = setInterval(() => {
    sendHeartbeat().catch(console.error);
  }, HEARTBEAT_INTERVAL_MS);

  if (typeof heartbeatTimer.unref === 'function') {
    heartbeatTimer.unref(); // Don't prevent process exit
  }
}

/** Stop the heartbeat (useful for tests). */
export function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// Start heartbeat on module load (safe in dev/tests/serverless)
startHeartbeat();

// ---------------------------------------------------------------------------
// Health event integration — convenience wrappers for system health changes
// ---------------------------------------------------------------------------

/** Push a database health event to SSE subscribers. */
export function notifyDatabaseHealth(healthy: boolean, organizationId?: string | null): void {
  const priority = healthy ? NotificationPriority.INFO : NotificationPriority.CRITICAL;
  pushNotification({
    title: healthy ? 'Database restored' : 'Database connection lost',
    message: healthy
      ? 'Database connectivity has been restored.'
      : 'Unable to reach the database. Operations may be degraded.',
    priority,
    scope: NotificationScope.GLOBAL, // Health events go to everyone
    source: 'health-check:database',
    organizationId,
  });
}

/** Push a Redis cache health event to SSE subscribers. */
export function notifyCacheHealth(healthy: boolean, organizationId?: string | null): void {
  const priority = healthy ? NotificationPriority.INFO : NotificationPriority.CRITICAL;
  pushNotification({
    title: healthy ? 'Cache restored' : 'Cache connection lost',
    message: healthy
      ? 'Redis cache connectivity has been restored.'
      : 'Cache is unavailable. The system will fall back to direct database queries.',
    priority,
    scope: NotificationScope.GLOBAL, // Health events go to everyone
    source: 'health-check:cache',
    organizationId,
  });
}

/** Push a PgBouncer health event to SSE subscribers. */
export function notifyPgbouncerHealth(healthy: boolean, organizationId?: string | null): void {
  const priority = healthy ? NotificationPriority.INFO : NotificationPriority.CRITICAL;
  pushNotification({
    title: healthy ? 'Connection pool restored' : 'Connection pool unavailable',
    message: healthy
      ? 'PgBouncer connection pool has been restored.'
      : 'Unable to reach the connection pool. Database connections may fail.',
    priority,
    scope: NotificationScope.GLOBAL, // Health events go to everyone
    source: 'health-check:pgbouncer',
    organizationId,
  });
}

/** Push an admin broadcast message to all subscribers. */
export function notifyAdminMessage(
  title: string,
  message: string,
  orgId?: string | null,
  priority: NotificationPriority = NotificationPriority.INFO,
): void {
  pushNotification({
    title,
    message,
    priority,
    scope: orgId ? NotificationScope.ORG : NotificationScope.GLOBAL,
    source: 'admin:message',
    organizationId: orgId,
  });
}

// ---------------------------------------------------------------------------
// Cleanup — periodically remove stale entries (safety net)
// ---------------------------------------------------------------------------

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startCleanup(): void {
  if (cleanupTimer) return;

  cleanupTimer = setInterval(() => {
    // Log subscriber count for monitoring (every 5 minutes)
    if (activeSubscribers.size > 0) {
      console.debug(`[SSE] Active subscribers: ${activeSubscribers.size}`);
    }
  }, 5 * 60 * 1000);

  if (typeof cleanupTimer.unref === 'function') {
    cleanupTimer.unref();
  }
}

startCleanup();

// ---------------------------------------------------------------------------
// Test helpers — reset state between tests
// ---------------------------------------------------------------------------

export function resetSubscriberStore(): void {
  // Close all writers to prevent resource leaks during tests
  for (const sub of activeSubscribers.values()) {
    try {
      sub.writer.close();
    } catch (e) {
      // Writer close may fail if already closed — safe to ignore
      void e;
    }
  }
  activeSubscribers.clear();
}
