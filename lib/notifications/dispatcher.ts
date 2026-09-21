/**
 * Notification dispatcher.
 *
 * Checks rate limits, sends email, and logs to NotificationLog.
 */

import tenantDb from '@/lib/tenant-db';
import { runWithTenant } from '@/lib/tenant-context';
import { getRedis } from '@/lib/redis';
import { sendEmail } from './email';
import { NOTIFICATION_RATE_LIMIT, type ExtremeEventType } from './events';
import { env } from '@/lib/env';

/**
 * Rate limit key for a given event type and recipient.
 */
function getRateLimitKey(eventType: ExtremeEventType, recipientEmail: string): string {
  return `notif:rate:${eventType}:${recipientEmail}`;
}

/**
 * Check if a notification should be sent (rate limit check).
 */
async function isWithinRateLimit(eventType: ExtremeEventType, recipientEmail: string): Promise<boolean> {
  const key = getRateLimitKey(eventType, recipientEmail);
  const windowSeconds = NOTIFICATION_RATE_LIMIT.windowHours * 3600;

  const redis = getRedis();
  if (!redis) {
    // If Redis is unavailable, allow the notification (fail open)
    return true;
  }

  // Get count of notifications in current window
  const count = await redis.get(key);
  if (count === null) {
    // First notification in window — set counter
    await redis.set(key, '1', 'EX', windowSeconds);
    return true;
  }

  const currentCount = parseInt(count, 10);
  if (currentCount >= NOTIFICATION_RATE_LIMIT.maxPerWindow) {
    return false; // Rate limited
  }

  // Increment counter
  await redis.incr(key);
  return true;
}

/**
 * Dispatch a notification email.
 */
export async function dispatchNotification(
  eventType: ExtremeEventType,
  recipientEmail: string,
  message: string,
  organizationId?: string | null
): Promise<{ sent: boolean; rateLimited: boolean }> {
  // Check rate limit
  const withinLimit = await isWithinRateLimit(eventType, recipientEmail);
  if (!withinLimit) {
    return { sent: false, rateLimited: true };
  }

  // Send email
  const subject = `Property NI — ${eventType} Alert`;
  const emailResult = await sendEmail(recipientEmail, subject, message);

  // Log to NotificationLog (not in tenantDb's scoped-model list — pass-through).
  await tenantDb.notificationLog.create({
    data: {
      recipientEmail,
      eventType,
      message,
      status: emailResult.success ? 'SENT' : 'FAILED',
      organizationId,
    },
  });

  return { sent: emailResult.success, rateLimited: false };
}

/**
 * Get all Super Admin emails from the database.
 */
export async function getSuperAdminEmails(): Promise<string[]> {
  const platformOrgId = env.PLATFORM_ORGANIZATION_ID;
  if (!platformOrgId) return []; // fail-closed: no verified platform org → nobody is a super admin
  // Member IS tenant-scoped in tenantDb — the platform-org id becomes the context.
  const members = await runWithTenant(platformOrgId, () =>
    tenantDb.member.findMany({
      where: { orgId: platformOrgId },
      select: { user: { select: { email: true } } },
    })
  );

  return members.map((m) => m.user.email).filter(Boolean);
}
