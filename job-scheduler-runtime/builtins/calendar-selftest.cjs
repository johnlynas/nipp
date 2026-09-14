/**
 * Built-in handler: `calendar-selftest`
 *
 * Proves the CALENDAR-priority notification path is reachable from a forked
 * worker without needing a real due-to-start event.
 *
 * Division of labor (SSE subscribers are parent-process memory — a worker can't
 * broadcast to them):
 *   - worker: verifies its own Prisma connection by persisting exactly one
 *     CALENDAR-priority Notification row through the schema/DB layer, then asks
 *     the PARENT to push the live SSE event (returned `pushNotifications` array;
 *     see lib/job-scheduler-engine.ts handleRun).
 *   - parent: pushes via pushNotification() so the probe lands on the platform
 *     ops ticker exactly like a real calendar reminder.
 *
 * Input: optional `{ message?, title? }` to customise the probe text.
 */
'use strict';

async function execute(ctx) {
  const input = (ctx.input && typeof ctx.input === 'object') ? ctx.input : {};
  const now = new Date();

  const title = typeof input.title === 'string' && input.title.length > 0
    ? String(input.title).slice(0, 200)
    : 'Calendar notification path: self-test';
  const message = typeof input.message === 'string' && input.message.length > 0
    ? String(input.message).slice(0, 400)
    : `CALENDAR-priority probe emitted at ${now.toISOString()} to verify the calendar notification pipeline.`;

  // Durable proof: the CALENDAR row persists through worker-side Prisma.
  const notification = await ctx.db().notification.create({
    data: {
      title,
      message,
      priority: 'CALENDAR',
      scope: 'GLOBAL',
      source: 'job-scheduler:calendar-selftest',
      organizationId: ctx.platformOrgId || null,
    },
  });

  // Live proof: the parent broadcasts this to SSE subscribers.
  const pushNotifications = [{
    title,
    message,
    priority: 'CALENDAR',
    scope: 'GLOBAL',
    source: 'job-scheduler:calendar-selftest',
    organizationId: ctx.platformOrgId || null,
  }];

  return {
    ok: true,
    handler: 'calendar-selftest',
    notificationId: notification.id,
    emittedAt: now.toISOString(),
    pushNotifications,
  };
}

module.exports = { execute };
