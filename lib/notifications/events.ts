/**
 * Extreme event types and thresholds for the notification system.
 *
 * When these thresholds are exceeded, email notifications are sent to
 * Super Admins and affected Org Admins.
 */

import { env } from '@/lib/env';

/**
 * Extreme event types that trigger notifications.
 */
export const EXTREME_EVENT_TYPES = {
  MASS_DELETION: 'MASS_DELETION',           // >100 records deleted in 1 hour
  BULK_ROLE_CHANGE: 'BULK_ROLE_CHANGE',     // >20 role changes in 1 hour
  SUSPICIOUS_LOGIN: 'SUSPICIOUS_LOGIN',     // Multiple failed logins from new IP
  ORG_SUSPENSION: 'ORG_SUSPENSION',         // Organization suspended
  ORG_ARCHIVAL: 'ORG_ARCHIVAL',             // Organization archived
  TODAY_EVENTS: 'TODAY_EVENTS',             // Today's calendar events notification
} as const;

export type ExtremeEventType = (typeof EXTREME_EVENT_TYPES)[keyof typeof EXTREME_EVENT_TYPES];

/**
 * Thresholds for each event type.
 */
export const EVENT_THRESHOLDS: Record<ExtremeEventType, { count: number; windowHours: number }> = {
  [EXTREME_EVENT_TYPES.MASS_DELETION]:     { count: 100, windowHours: 1 },
  [EXTREME_EVENT_TYPES.BULK_ROLE_CHANGE]:  { count: 20, windowHours: 1 },
  [EXTREME_EVENT_TYPES.SUSPICIOUS_LOGIN]:  { count: 5, windowHours: 1 },
  [EXTREME_EVENT_TYPES.ORG_SUSPENSION]:    { count: 1, windowHours: 24 },
  [EXTREME_EVENT_TYPES.ORG_ARCHIVAL]:      { count: 1, windowHours: 24 },
  [EXTREME_EVENT_TYPES.TODAY_EVENTS]:      { count: 1, windowHours: 24 },
};

/**
 * Notification rate limit: max notifications per event type per recipient per window.
 * Configurable via env vars with sensible defaults:
 *   RATE_LIMIT_NOTIFICATION_MAX          — max notifications (default 5)
 *   RATE_LIMIT_NOTIFICATION_WINDOW_HOURS — window in hours (default 24)
 */
const NOTIFICATION_MAX = Number(env.RATE_LIMIT_NOTIFICATION_MAX ?? 5);
const NOTIFICATION_WINDOW_HOURS = Number(env.RATE_LIMIT_NOTIFICATION_WINDOW_HOURS ?? 24);

export const NOTIFICATION_RATE_LIMIT = {
  maxPerWindow: NOTIFICATION_MAX,
  windowHours: NOTIFICATION_WINDOW_HOURS,
};

/**
 * Generate a human-readable message for an extreme event.
 */
export function generateEventMessage(
  eventType: ExtremeEventType,
  metadata: Record<string, unknown>
): string {
  switch (eventType) {
    case EXTREME_EVENT_TYPES.MASS_DELETION:
      return `Mass deletion detected: ${metadata.count} records of type "${metadata.resourceType}" deleted within ${metadata.windowHours}h by user ${metadata.userId}.`;
    case EXTREME_EVENT_TYPES.BULK_ROLE_CHANGE:
      return `Bulk role change detected: ${metadata.count} members had roles changed in organization ${metadata.organizationId}.`;
    case EXTREME_EVENT_TYPES.SUSPICIOUS_LOGIN:
      return `Suspicious login activity: ${metadata.count} failed attempts from IP ${metadata.ipAddress} for user ${metadata.userId}.`;
    case EXTREME_EVENT_TYPES.ORG_SUSPENSION:
      return `Organization "${metadata.orgName}" (ID: ${metadata.organizationId}) has been suspended by Super Admin ${metadata.adminName}.`;
    case EXTREME_EVENT_TYPES.ORG_ARCHIVAL:
      return `Organization "${metadata.orgName}" (ID: ${metadata.organizationId}) has been archived by Super Admin ${metadata.adminName}.`;
    case EXTREME_EVENT_TYPES.TODAY_EVENTS:
      return `Today's calendar events: ${metadata.count} event(s) scheduled for today.`;
    default:
      return `Extreme event detected: ${eventType}`;
  }
}
