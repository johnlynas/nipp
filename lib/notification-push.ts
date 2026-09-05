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
const DEDUP_WINDOW_MS = 10_000;

// ---------------------------------------------------------------------------
// Connection tracking — in-memory store keyed by session ID
//
// CRITICAL: all mutable module state below must be process-unique, not
// module-instance-unique. Next.js dev mode (and some bundling configs) can
// evaluate the same module more than once per process; a plain `new Map()`
// then gives each copy its own store — which is exactly why the SSE route's
// subscribers were "invisible" to pushNotification() in another copy.
// Keying by name on globalThis makes every copy share one store, matching
// production (single module instance) behavior, and is harmless for tests
// (vitest gives each test file a fresh worker/global scope).
// ---------------------------------------------------------------------------

type SseState = {
  subscribers: Map<string, SseSubscriber>;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  cleanupTimer: ReturnType<typeof setInterval> | null;
};

function getSseState(): SseState {
  const g = globalThis as unknown as Record<string, SseState>;
  if (!g.sseNotificationPushState) {
    g.sseNotificationPushState = {
      subscribers: new Map(),
      heartbeatTimer: null,
      cleanupTimer: null,
    };
  }
  // Return a stable view so `activeSubscribers` below keeps working everywhere.
  return g.sseNotificationPushState;
}

const sseState = getSseState();
const activeSubscribers = sseState.subscribers;

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

// ---------------------------------------------------------------------------
// In-process dedup index — synchronous gate in front of pushNotification()
//
// The DB-based dedup is an async findFirst → create sequence, so two truly
// concurrent calls (e.g. two /api/health requests racing on boot, both seeing
// previousState === null) can both pass the check before either persists —
// producing duplicated boot notifications. This map closes that TOCTOU gap:
// it is checked AND marked synchronously at the top of pushNotification(),
// which is atomic on the single-threaded event loop regardless of awaits.
// The DB check remains as a safety net across multiple server instances.
// ---------------------------------------------------------------------------

function getDedupIndex(): Map<string, number> {
  const g = globalThis as unknown as Record<string, Map<string, number>>;
  if (!g.sseNotificationDedupIndex) {
    g.sseNotificationDedupIndex = new Map();
  }
  return g.sseNotificationDedupIndex;
}

function buildDedupKey(params: {
  title: string;
  message: string;
  priority: NotificationPriority;
  scope: NotificationScope;
  source?: string | null;
  organizationId?: string | null;
}): string {
  return [
    params.priority,
    params.scope,
    params.source ?? null,
    params.organizationId ?? null,
    params.title,
    params.message,
  ].join('\u0000');
}

/** Returns true if this exact notification was already pushed within the window. */
function isDuplicateNotification(params: {
  title: string;
  message: string;
  priority: NotificationPriority;
  scope: NotificationScope;
  source?: string | null;
  organizationId?: string | null;
}): boolean {
  const index = getDedupIndex();
  const now = Date.now();
  // Opportunistic cleanup so the map stays small under load
  if (index.size > 256) {
    for (const [key, at] of index) {
      if (now - at > DEDUP_WINDOW_MS) index.delete(key);
    }
  }
  const key = buildDedupKey(params);
  const lastPushedAt = index.get(key);
  if (lastPushedAt !== undefined && now - lastPushedAt < DEDUP_WINDOW_MS) {
    return true;
  }
  // Mark synchronously — see note above about atomicity.
  index.set(key, now);
  return false;
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

  // Synchronous in-process dedup — catches concurrent identical pushes that
  // the async DB check below can't (e.g. boot-time health race).
  if (isDuplicateNotification({
    title: payload.title,
    message: payload.message,
    priority: normalizedPriority,
    scope: payload.scope,
    source: payload.source,
    organizationId: payload.organizationId,
  })) {
    console.log(`[SSE] Dedup (in-process) — skipping duplicate notification: ${payload.title}`);
    return;
  }

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

  // Dedup (multi-instance safety net — the in-process index above already
  // catches same-process races): skip if an identical notification was
  // persisted within the last window.
  const dedupWindow = new Date(Date.now() - DEDUP_WINDOW_MS);
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
 * The timer handle lives in shared process state so duplicate module copies
 * (see connection-tracking note above) never run two heartbeats.
 */
export function startHeartbeat(): void {
  if (sseState.heartbeatTimer) return; // Already running

  const timer = setInterval(() => {
    sendHeartbeat().catch(console.error);
  }, HEARTBEAT_INTERVAL_MS);

  sseState.heartbeatTimer = timer;

  if (typeof timer.unref === 'function') {
    timer.unref(); // Don't prevent process exit
  }
}

/** Stop the heartbeat (useful for tests). */
export function stopHeartbeat(): void {
  if (sseState.heartbeatTimer) {
    clearInterval(sseState.heartbeatTimer);
    sseState.heartbeatTimer = null;
  }
}

// Start heartbeat on module load (safe in dev/tests/serverless)
startHeartbeat();

// ---------------------------------------------------------------------------
// Health event integration — convenience wrapper for system health changes
// ---------------------------------------------------------------------------

export type HealthService = 'database' | 'cache' | 'pgbouncer';

const HEALTH_SERVICE_META: Record<HealthService, { title: string; source: string }> = {
  database: { title: 'Database health check', source: 'health-check:database' },
  cache: { title: 'Cache health check', source: 'health-check:cache' },
  pgbouncer: { title: 'Connection pool health check', source: 'health-check:pgbouncer' },
};

/**
 * Push a system health event for a monitored service to SSE subscribers.
 * - Healthy (success / recovery): INFO priority
 * - Unhealthy (first failure): CRITICAL priority — persists until dismissed
 *
 * GLOBAL scope (health events go to everyone). The platform organization id
 * is passed through when known so the history table can show which org's
 * infrastructure was checked. Callers are responsible for calling this only
 * on state transitions, not on every poll tick.
 */
export async function notifyHealthCheck(
  service: HealthService,
  healthy: boolean,
  organizationId?: string | null,
): Promise<void> {
  const { title, source } = HEALTH_SERVICE_META[service];
  await pushNotification({
    title: `${title} ${healthy ? 'passed' : 'failed'}`,
    message: healthy
      ? `${title} passed. Service is responsive.`
      : `${title} failed. The service is unreachable and may degrade platform operations.`,
    priority: healthy ? NotificationPriority.INFO : NotificationPriority.CRITICAL,
    scope: NotificationScope.GLOBAL, // Health events go to everyone
    source,
    organizationId: organizationId ?? null,
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

/**
 * Push a platform user-management event (create/update/delete) to SSE subscribers.
 * - Success: INFO priority
 * - Failure: ERROR priority
 *
 * GLOBAL scope (platform-wide super-admin operations), but `organizationId` is
 * passed through when known so the history table and per-org consumers can show
 * which organization the affected user belongs to.
 */
export async function notifyUserOperation(
  operation: 'create' | 'update' | 'delete',
  targetLabel: string,
  success: boolean,
  errorMessage?: string,
  organizationId?: string | null,
): Promise<void> {
  const titles: Record<typeof operation, [string, string]> = {
    create: ['User created', 'Failed to create user'],
    update: ['User updated', 'Failed to update user'],
    delete: ['User deleted', 'Failed to delete user'],
  };
  const [successTitle, failureTitle] = titles[operation];
  await pushNotification({
    title: success ? successTitle : failureTitle,
    message: success
      ? `${targetLabel} was ${operation === 'create' ? 'created' : `${operation}d`} successfully.`
      : `The ${operation} operation failed for ${targetLabel}. ${errorMessage ?? 'No error details available.'}`,
    priority: success ? NotificationPriority.INFO : NotificationPriority.ERROR,
    scope: NotificationScope.GLOBAL,
    source: 'admin:user-management',
    organizationId: organizationId ?? null,
  });
}

/**
 * Push a platform organization-management event (create/update/archive) to SSE subscribers.
 * - Success: INFO priority
 * - Failure: ERROR priority
 *
 * GLOBAL scope (platform-wide super-admin operations). `organizationId` is
 * passed through when known (usually the affected organization itself) so the
 * history table and per-org consumers can show which organization was affected.
 *
 * Note: organizations cannot be hard-deleted — archiving is the terminal
 * removal, hence the 'archive' operation.
 */
export async function notifyOrganizationOperation(
  operation: 'create' | 'update' | 'archive',
  targetLabel: string,
  success: boolean,
  errorMessage?: string,
  organizationId?: string | null,
): Promise<void> {
  const titles: Record<typeof operation, [string, string]> = {
    create: ['Organization created', 'Failed to create organization'],
    update: ['Organization updated', 'Failed to update organization'],
    archive: ['Organization archived', 'Failed to archive organization'],
  };
  const [successTitle, failureTitle] = titles[operation];
  await pushNotification({
    title: success ? successTitle : failureTitle,
    message: success
      ? `${targetLabel} was ${
          operation === 'create' ? 'created' : operation === 'update' ? 'updated' : 'archived'
        } successfully.`
      : `The ${operation} operation failed for ${targetLabel}. ${errorMessage ?? 'No error details available.'}`,
    priority: success ? NotificationPriority.INFO : NotificationPriority.ERROR,
    scope: NotificationScope.GLOBAL,
    source: 'admin:organization-management',
    organizationId: organizationId ?? null,
  });
}

/**
 * Push a platform team-management event (create/update/delete) to SSE subscribers.
 * - Success: INFO priority
 * - Failure: ERROR priority
 *
 * GLOBAL scope (platform-wide super-admin operations). `organizationId` is
 * passed through when known (usually the team's organization) so the history
 * table and per-org consumers can show which organization was affected.
 */
export async function notifyTeamOperation(
  operation: 'create' | 'update' | 'delete',
  targetLabel: string,
  success: boolean,
  errorMessage?: string,
  organizationId?: string | null,
): Promise<void> {
  const titles: Record<typeof operation, [string, string]> = {
    create: ['Team created', 'Failed to create team'],
    update: ['Team updated', 'Failed to update team'],
    delete: ['Team deleted', 'Failed to delete team'],
  };
  const [successTitle, failureTitle] = titles[operation];
  await pushNotification({
    title: success ? successTitle : failureTitle,
    message: success
      ? `${targetLabel} was ${operation === 'create' ? 'created' : `${operation}d`} successfully.`
      : `The ${operation} operation failed for ${targetLabel}. ${errorMessage ?? 'No error details available.'}`,
    priority: success ? NotificationPriority.INFO : NotificationPriority.ERROR,
    scope: NotificationScope.GLOBAL,
    source: 'admin:team-management',
    organizationId: organizationId ?? null,
  });
}

/**
 * Push a platform role-management event (create/update/delete) to SSE subscribers.
 * - Success: INFO priority
 * - Failure: ERROR priority
 *
 * GLOBAL scope (platform-wide super-admin operations). `organizationId` is
 * passed through when known (the role's organization) so the history table
 * and per-org consumers can show which organization was affected.
 */
export async function notifyRoleOperation(
  operation: 'create' | 'update' | 'delete',
  targetLabel: string,
  success: boolean,
  errorMessage?: string,
  organizationId?: string | null,
): Promise<void> {
  const titles: Record<typeof operation, [string, string]> = {
    create: ['Role created', 'Failed to create role'],
    update: ['Role updated', 'Failed to update role'],
    delete: ['Role deleted', 'Failed to delete role'],
  };
  const [successTitle, failureTitle] = titles[operation];
  await pushNotification({
    title: success ? successTitle : failureTitle,
    message: success
      ? `${targetLabel} was ${operation === 'create' ? 'created' : `${operation}d`} successfully.`
      : `The ${operation} operation failed for ${targetLabel}. ${errorMessage ?? 'No error details available.'}`,
    priority: success ? NotificationPriority.INFO : NotificationPriority.ERROR,
    scope: NotificationScope.GLOBAL,
    source: 'admin:role-management',
    organizationId: organizationId ?? null,
  });
}

/**
 * Push a platform permission-management event (create/update/delete) to SSE subscribers.
 * - Success: INFO priority
 * - Failure: ERROR priority
 *
 * GLOBAL scope (platform-wide super-admin operations). Permissions are
 * global (non-org-scoped) catalog entries, so no organizationId is attached.
 */
export async function notifyPermissionOperation(
  operation: 'create' | 'update' | 'delete',
  targetLabel: string,
  success: boolean,
  errorMessage?: string,
): Promise<void> {
  const titles: Record<typeof operation, [string, string]> = {
    create: ['Permission created', 'Failed to create permission'],
    update: ['Permission updated', 'Failed to update permission'],
    delete: ['Permission deleted', 'Failed to delete permission'],
  };
  const [successTitle, failureTitle] = titles[operation];
  await pushNotification({
    title: success ? successTitle : failureTitle,
    message: success
      ? `${targetLabel} was ${operation === 'create' ? 'created' : `${operation}d`} successfully.`
      : `The ${operation} operation failed for ${targetLabel}. ${errorMessage ?? 'No error details available.'}`,
    priority: success ? NotificationPriority.INFO : NotificationPriority.ERROR,
    scope: NotificationScope.GLOBAL,
    source: 'admin:permission-management',
    organizationId: null,
  });
}

/**
 * Push a platform resource-management event (create/update/delete) to SSE subscribers.
 * - Success: INFO priority
 * - Failure: ERROR priority
 *
 * GLOBAL scope (platform-wide super-admin operations). Resources are
 * global (non-org-scoped) catalog entries, so no organizationId is attached.
 */
export async function notifyResourceOperation(
  operation: 'create' | 'update' | 'delete',
  targetLabel: string,
  success: boolean,
  errorMessage?: string,
): Promise<void> {
  const titles: Record<typeof operation, [string, string]> = {
    create: ['Resource created', 'Failed to create resource'],
    update: ['Resource updated', 'Failed to update resource'],
    delete: ['Resource deleted', 'Failed to delete resource'],
  };
  const [successTitle, failureTitle] = titles[operation];
  await pushNotification({
    title: success ? successTitle : failureTitle,
    message: success
      ? `${targetLabel} was ${operation === 'create' ? 'created' : `${operation}d`} successfully.`
      : `The ${operation} operation failed for ${targetLabel}. ${errorMessage ?? 'No error details available.'}`,
    priority: success ? NotificationPriority.INFO : NotificationPriority.ERROR,
    scope: NotificationScope.GLOBAL,
    source: 'admin:resource-management',
    organizationId: null,
  });
}

// ---------------------------------------------------------------------------
// Cleanup — periodically remove stale entries (safety net)
// ---------------------------------------------------------------------------

function startCleanup(): void {
  if (sseState.cleanupTimer) return;

  const timer = setInterval(() => {
    // Log subscriber count for monitoring (every 5 minutes)
    if (activeSubscribers.size > 0) {
      console.debug(`[SSE] Active subscribers: ${activeSubscribers.size}`);
    }
  }, 5 * 60 * 1000);

  sseState.cleanupTimer = timer;

  if (typeof timer.unref === 'function') {
    timer.unref();
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

/** Clear the in-process dedup index (useful for tests). */
export function resetNotificationDedupIndex(): void {
  getDedupIndex().clear();
}

// ---------------------------------------------------------------------------
// Organization lifecycle notifications — suspension, archival, reactivation
// ---------------------------------------------------------------------------

/**
 * Push an SSE notification when an organization is suspended and all users are banned.
 * - Priority: WARNING
 * - Scope: GLOBAL (platform-wide)
 */
export async function notifyOrganizationSuspension(
  orgId: string,
  orgName: string,
  userCount: number,
  adminName?: string,
): Promise<void> {
  await pushNotification({
    title: `Organization "${orgName}" suspended`,
    message: `All ${userCount} user(s) in organization "${orgName}" (ID: ${orgId}) have been banned and can no longer log in. This action was triggered by Super Admin ${adminName ?? 'a platform administrator'}.`,
    priority: NotificationPriority.WARNING,
    scope: NotificationScope.GLOBAL,
    source: 'admin:organization-suspension',
    organizationId: orgId ?? null,
  });
}

/**
 * Push an SSE notification when an organization is archived and all users are banned.
 * - Priority: WARNING
 * - Scope: GLOBAL (platform-wide)
 *
 * Archiving is permanent — users cannot be automatically reactivated.
 * A platform user must manually unblock each banned user and add them to another organization.
 */
export async function notifyOrganizationArchival(
  orgId: string,
  orgName: string,
  userCount: number,
  adminName?: string,
): Promise<void> {
  await pushNotification({
    title: `Organization "${orgName}" archived`,
    message: `All ${userCount} user(s) in organization "${orgName}" (ID: ${orgId}) have been banned and can no longer log in. This action was triggered by Super Admin ${adminName ?? 'a platform administrator'}. Note: Archiving is permanent. Users cannot be automatically reactivated — a platform user must manually unblock each banned user and add them to another organization.`,
    priority: NotificationPriority.WARNING,
    scope: NotificationScope.GLOBAL,
    source: 'admin:organization-archival',
    organizationId: orgId ?? null,
  });
}

/**
 * Push an SSE notification when a previously suspended organization is reactivated and all users are unbanned.
 * - Priority: INFO
 * - Scope: GLOBAL (platform-wide)
 */
export async function notifyOrganizationReactivation(
  orgId: string,
  orgName: string,
  userCount: number,
  adminName?: string,
): Promise<void> {
  await pushNotification({
    title: `Organization "${orgName}" reactivated`,
    message: `All ${userCount} user(s) in organization "${orgName}" (ID: ${orgId}) have been reactivated and can now log in again. This action was triggered by Super Admin ${adminName ?? 'a platform administrator'}.`,
    priority: NotificationPriority.INFO,
    scope: NotificationScope.GLOBAL,
    source: 'admin:organization-reactivation',
    organizationId: orgId ?? null,
  });
}
