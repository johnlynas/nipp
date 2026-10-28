/**
 * Work order quote-deadline scan (design §Scheduling).
 *
 * Hourly built-in job: finds work orders stuck in OUT_FOR_QUOTES past their
 * quotesDue date and raises a one-time, idempotent overdue alert — an ORG-scoped
 * notification the org's members see, plus a GLOBAL WARNING escalation for the
 * admin dashboard / super admins (SSE). Super admins then follow up with
 * contractors DIRECTLY (manual in v1 — no automatic state change: not all
 * invited contractors respond and the org works with the quotes that arrive).
 *
 * Idempotency: `WorkOrder.deadlineAlertAt` is set when the alert fires, so a
 * repeated hourly run never re-notifies.
 *
 * RLS context rule (design §Tenant Isolation, same as Phase 2 mutations):
 *   - the scan READ runs under the env platform context (read-only-safe), and
 *   - each deadlineAlertAt UPDATE is pinned to the affected row's org via a
 *     tenant-ADMIN context (policy WITH CHECK requires app.current_org_id).
 */

import { NotificationPriority, NotificationScope } from '@prisma/client';
import tenantDb from '@/lib/tenant-db';
import { withEnvPlatformContext } from '@/lib/rls-transaction';
import { withTenantAdminContext } from '@/lib/platform-db';
import { pushNotification } from '@/lib/notification-push';
import { logger } from '@/lib/logger';
import type { JobHandler } from '@/services/job-scheduler-service';

export interface DeadlineScanResult {
  scanned: number;
  alerted: number;
}

interface OverdueRow {
  workOrderId: string;
  organizationId: string;
  quotesDue: Date | null;
}

/**
 * Scan for overdue quotation deadlines and raise idempotent alerts.
 * Exported with an injected `now` so unit tests are deterministic.
 * A failing row (RLS reject etc.) is logged and skipped — the rest continue.
 */
export async function runWorkOrderDeadlineScan(args: { now?: Date; platformUserId: string }): Promise<DeadlineScanResult> {
  const now = args.now ?? new Date();

  // Read under the env platform context (platform admin sees all orgs).
  const rows = await withEnvPlatformContext(() =>
    tenantDb.workOrder.findMany({
      where: {
        state: 'OUT_FOR_QUOTES',
        quotesDue: { lte: now },
        deadlineAlertAt: null, // idempotency: not yet alerted
      },
      select: { workOrderId: true, organizationId: true, quotesDue: true },
    }),
  ) as unknown as OverdueRow[];

  let alerted = 0;
  for (const row of rows) {
    try {
      const orgName = (
        await withEnvPlatformContext(() =>
          tenantDb.organization.findUnique({ where: { id: row.organizationId }, select: { name: true } }),
        )
      )?.name ?? 'the organization';

      const message = `Quotations overdue for work order ${row.workOrderId} — no responses received by ${
        row.quotesDue ? new Date(row.quotesDue).toISOString().slice(0, 10) : 'the due date'
      }. Please follow up with the invited contractors.`;

      // ORG scope: the affected org's members (super admins see it too).
      await pushNotification({
        title: `Quotations overdue — work order ${row.workOrderId}`,
        message,
        priority: NotificationPriority.WARNING,
        scope: NotificationScope.ORG,
        source: 'work-order:quote-deadline',
        organizationId: row.organizationId,
      });

      // GLOBAL scope: the super-admin escalation (admin dashboard + SSE).
      await pushNotification({
        title: `Quotations overdue — ${orgName}`,
        message,
        priority: NotificationPriority.WARNING,
        scope: NotificationScope.GLOBAL,
        source: 'work-order:quote-deadline',
        organizationId: row.organizationId,
      });

      // Pin the write to the row's own org (RLS WITH CHECK — a platform context
      // alone fails closed on this UPDATE).
      await withTenantAdminContext(args.platformUserId, row.organizationId, () =>
        tenantDb.workOrder.update({
          where: { workOrderId: row.workOrderId },
          data: { deadlineAlertAt: now },
        }),
      );

      alerted++;
      logger.info(
        { workOrderId: row.workOrderId, orgId: row.organizationId, quotesDue: row.quotesDue ? new Date(row.quotesDue).toISOString() : null },
        'Work order quote deadline alert raised',
      );
    } catch (err) {
      // One bad row must not kill the run — log and continue.
      logger.error({ err, workOrderId: row.workOrderId, orgId: row.organizationId }, 'Work order deadline alert failed for a row');
    }
  }

  return { scanned: rows.length, alerted };
}

/**
 * Built-in job handler (registered under `work-order-quote-deadlines`).
 * Returns the {scanned, alerted} summary — JSON-serializable and persisted to
 * JobExecution.resultJson (matches the existing built-in return contracts).
 */
export const workOrdersQuoteDeadlinesHandler: JobHandler = async (ctx) => {
  // Optional `{ now }` in the job input lets manual / dry-run triggers pin a
  // deterministic clock; scheduled runs use real time.
  const input = (ctx.input ?? {}) as { now?: unknown };
  let now: Date | undefined;
  if (typeof input.now === 'string') {
    const parsed = new Date(input.now);
    if (!Number.isNaN(parsed.getTime())) now = parsed;
  }

  const result = await runWorkOrderDeadlineScan({ now, platformUserId: `job:${ctx.jobDefinitionId}` });
  return { handler: 'work-order-quote-deadlines', scanned: result.scanned, alerted: result.alerted };
};
