/**
 * CalendarNotificationService — sends today's event notifications to users/organizations.
 *
 * Reuses existing notification infrastructure:
 * - dispatchNotification (lib/notifications/dispatcher.ts) for email sending + rate limiting
 * - NotificationLog (Prisma model) for delivery tracking
 */

// RLS Phase 3: tenantDb (scoped) replaces the unscoped globalDb; each read runs
// inside runWithTenant(targetOrgId) matching calendar-event-service.
import tenantDb from '@/lib/tenant-db';
import { runWithTenant } from '@/lib/tenant-context';
import { logger } from '@/lib/logger';
import {
  ServiceContext,
  ValidationError,
} from '@/lib/services/types';
import { requireAnyAdmin } from '@/lib/services/base-service';
import { dispatchNotification } from '@/lib/notifications/dispatcher';

// ---------------------------------------------------------------------------
// Input / Output Types
// ---------------------------------------------------------------------------

export interface NotificationResult {
  email: string;
  status: 'SENT' | 'RATE_LIMITED' | 'FAILED';
  error?: string;
}

export interface SendNotificationsInput {
  userId?: string;
  organizationId: string;
  eventIds?: string[];
  notifyType?: 'TODAY_EVENTS';
}

export interface TodayEvent {
  id: string;
  title: string;
  description?: string | null;
  startDate: Date;
  endDate: Date;
  eventType: 'VIEWING' | 'INSPECTION' | 'MAINTENANCE' | 'LEASE_SIGNING' | 'LEASE_RENEWAL' | 'KEY_EXCHANGE' | 'OTHER';
  color?: string | null;
}

// ---------------------------------------------------------------------------
// Event type display helpers
// ---------------------------------------------------------------------------

const EVENT_TYPE_LABELS: Record<string, string> = {
  VIEWING: 'Viewing',
  INSPECTION: 'Inspection',
  MAINTENANCE: 'Maintenance',
  LEASE_SIGNING: 'Lease Signing',
  LEASE_RENEWAL: 'Lease Renewal',
  KEY_EXCHANGE: 'Key Exchange',
  OTHER: 'Other',
};

const EVENT_TYPE_COLORS: Record<string, string> = {
  VIEWING: '#2A9D8F',
  INSPECTION: '#F5A623',
  MAINTENANCE: '#E76F51',
  LEASE_SIGNING: '#1B2A4A',
  LEASE_RENEWAL: '#7B68AE',
  KEY_EXCHANGE: '#D4A017',
  OTHER: '#6C757D',
};

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// Service methods
// ---------------------------------------------------------------------------

/**
 * Get all calendar events happening on the current date within an organization.
 */
export async function getTodayEvents(
  ctx: ServiceContext,
  orgId?: string,
): Promise<TodayEvent[]> {
  const targetOrgId = orgId ?? ctx.organizationId;

  if (!targetOrgId) {
    throw new ValidationError('Organization context is required');
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Events where startDate falls on today OR events that span today
  const events = await runWithTenant(targetOrgId, () => tenantDb.calendarEvent.findMany({
    where: {
      organizationId: targetOrgId,
      OR: [
        // Events starting today
        { startDate: { gte: today, lt: tomorrow } },
        // Events spanning today (start before tomorrow AND end after today)
        { startDate: { lt: tomorrow }, endDate: { gte: today } },
      ],
    },
    orderBy: { startDate: 'asc' },
  }));

  return events.map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    startDate: e.startDate,
    endDate: e.endDate,
    eventType: e.eventType as TodayEvent['eventType'],
    color: e.color,
  }));
}

/**
 * Get today's events for a specific user within their organization.
 */
export async function getTodayEventsForUser(
  ctx: ServiceContext,
  _userId?: string,
): Promise<TodayEvent[]> {
  const targetOrgId = ctx.organizationId;

  if (!targetOrgId) {
    throw new ValidationError('Organization context is required');
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const events = await runWithTenant(targetOrgId, () => tenantDb.calendarEvent.findMany({
    where: {
      organizationId: targetOrgId,
      OR: [
        { startDate: { gte: today, lt: tomorrow } },
        { startDate: { lt: tomorrow }, endDate: { gte: today } },
      ],
    },
    orderBy: { startDate: 'asc' },
  }));

  return events.map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    startDate: e.startDate,
    endDate: e.endDate,
    eventType: e.eventType as TodayEvent['eventType'],
    color: e.color,
  }));
}

/**
 * Build a branded email message for today's events.
 */
export function buildTodayEventsMessage(
  events: TodayEvent[],
  recipientName: string,
): { subject: string; html: string; text: string } {
  const todayStr = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  if (events.length === 0) {
    return {
      subject: 'Property NI — No Events Today',
      html: buildEmailHtml(todayStr, recipientName, events),
      text: `Hi ${recipientName},\n\nYou have no events scheduled for today (${todayStr}).\n\n---\nThis is an automated notification from Property NI. Do not reply.`,
    };
  }

  return {
    subject: 'Property NI — Today\'s Events',
    html: buildEmailHtml(todayStr, recipientName, events),
    text: buildTextMessage(todayStr, recipientName, events),
  };
}

/**
 * Build the HTML email template with Property NI branding.
 */
function buildEmailHtml(
  todayStr: string,
  recipientName: string,
  events: TodayEvent[],
): string {
  const eventRows = events.map((e) => {
    const color = EVENT_TYPE_COLORS[e.eventType] || '#6C757D';
    const label = EVENT_TYPE_LABELS[e.eventType] || 'Other';
    return `
      <tr>
        <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">
          <table cellpadding="0" cellspacing="0">
            <tr>
              <td style="width: 12px; height: 40px; background-color: ${color}; border-radius: 3px 0 0 3px;"></td>
              <td style="padding: 8px 12px; background-color: #ffffff;">
                <div style="font-weight: 600; color: #1B2A4A; font-size: 14px;">${escapeHtml(e.title)}</div>
                <div style="color: #6c757d; font-size: 12px;">
                  ${formatTime(e.startDate)} – ${formatTime(e.endDate)} · <span style="color: ${color}; font-weight: 500;">${label}</span>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8f9fa;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto;">
    <!-- Header -->
    <tr>
      <td style="background-color: #1B2A4A; padding: 24px 32px;">
        <h1 style="margin: 0; color: #ffffff; font-size: 20px;">Property NI — Today's Events</h1>
      </td>
    </tr>
    <!-- Body -->
    <tr>
      <td style="padding: 32px; background-color: #ffffff;">
        <p style="color: #1e3a5f; font-size: 16px; line-height: 1.6;">Hi ${escapeHtml(recipientName)},</p>
        <p style="color: #1e3a5f; font-size: 14px; line-height: 1.6;">Here are your events for <strong>${todayStr}</strong>:</p>
        <!-- Event list -->
        <table cellpadding="0" cellspacing="0" style="width: 100%; margin-top: 16px;">
          ${eventRows}
        </table>
        <!-- Amber accent bar -->
        <div style="height: 4px; background-color: #F5A623; margin-top: 24px;"></div>
      </td>
    </tr>
    <!-- Footer -->
    <tr>
      <td style="background-color: #f8f9fa; padding: 16px 32px; text-align: center;">
        <p style="color: #6c757d; font-size: 12px; margin: 0;">
          This is an automated notification from Property NI. Do not reply.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildTextMessage(
  todayStr: string,
  recipientName: string,
  events: TodayEvent[],
): string {
  const lines = [
    `Hi ${recipientName},`,
    '',
    `Here are your events for ${todayStr}:`,
    '',
  ];

  for (const e of events) {
    const label = EVENT_TYPE_LABELS[e.eventType] || 'Other';
    lines.push(`  ${e.title}`);
    lines.push(`  ${formatTime(e.startDate)} – ${formatTime(e.endDate)} · ${label}`);
    if (e.description) {
      lines.push(`  ${e.description}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('This is an automated notification from Property NI. Do not reply.');

  return lines.join('\n');
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Send today's event notifications to users or an organization.
 */
export async function sendTodayEventNotifications(
  ctx: ServiceContext,
  input: SendNotificationsInput,
): Promise<NotificationResult[]> {
  requireAnyAdmin(ctx);

  const targetOrgId = input.organizationId;

  if (!targetOrgId) {
    throw new ValidationError('Organization ID is required');
  }

  // Get today's events for the organization
  const events = await getTodayEvents(ctx, targetOrgId);

  if (events.length === 0) {
    logger.info({ userId: ctx.userId }, 'No events today — skipping notifications');
    return [];
  }

  const results: NotificationResult[] = [];

  // Resolve recipients
  let recipients: { email: string; name: string }[] = [];

  if (input.userId) {
    // Single user notification
    const member = await runWithTenant(targetOrgId, () => tenantDb.member.findFirst({
      where: { userId: input.userId, orgId: targetOrgId },
      include: { user: true },
    }));

    if (member?.user) {
      recipients = [{ email: member.user.email, name: member.user.name }];
    }
  } else {
    // Organization-wide — all members
    const members = await runWithTenant(targetOrgId, () => tenantDb.member.findMany({
      where: { orgId: targetOrgId },
      include: { user: true },
    }));

    recipients = members
      .filter((m) => m.user?.email)
      .map((m) => ({ email: m.user!.email!, name: m.user!.name }));
  }

  // Build message template
  const { text } = buildTodayEventsMessage(events, '');

  // Send to each recipient
  for (const recipient of recipients) {
    const dispatchResult = await dispatchNotification(
      'TODAY_EVENTS',
      recipient.email,
      text,
      targetOrgId,
    );

    if (dispatchResult.rateLimited) {
      results.push({ email: recipient.email, status: 'RATE_LIMITED' });
    } else if (dispatchResult.sent) {
      results.push({ email: recipient.email, status: 'SENT' });
    } else {
      results.push({ email: recipient.email, status: 'FAILED', error: 'Email delivery failed' });
    }
  }

  logger.info(
    { userId: ctx.userId, results },
    `Today event notifications sent to ${results.length} recipients`,
  );

  return results;
}

/**
 * CalendarNotificationService — today events queries and notification dispatch.
 */
export const CalendarNotificationService = {
  getTodayEvents,
  getTodayEventsForUser,
  buildTodayEventsMessage,
  sendTodayEventNotifications,
};
