/**
 * Work Order emails — plain notification emails on the OIDC-invite pipeline.
 *
 * Same branded sendEmail transport as the Google OIDC invite flow
 * (lib/notifications/email.ts → Property NI template header). What is stripped
 * from that pattern is the magic URL: these are informational notices with no
 * links, tokens or workflow URLs at all (design D7) — contractors respond by
 * phone/reply and super admins key responses into the portal. The NO_URL_RE
 * invariant is asserted inside every render, so a future template change that
 * smuggles a URL in fails loudly at send time instead of quietly auditing it.
 *
 * Failure tolerance (design T2): a failed SMTP send is logged (logger.warn) and
 * recorded as a FAILED NotificationLog row — it NEVER throws into the state
 * transition, which has already committed by the time dispatch runs.
 */

import { sendEmail } from '@/lib/notifications/email';
import tenantDb from '@/lib/tenant-db';
import { withEnvPlatformContext } from '@/lib/rls-transaction';
import { logger } from '@/lib/logger';
import type { WorkOrder } from '@prisma/client';
import type { WorkOrderEmailEvent } from './work-order-service';

/** No emailed URL is ever produced by a work order email (design D7). */
export const NO_URL_RE = /https?:\/\//i;

const HEADER_RFQ = 'Property NI — Quotation Request';
const HEADER_ASSIGNMENT = 'Property NI — Work Assigned';
const HEADER_INVOICE = 'Property NI — Invoice Request';
const DEFAULT_INVOICE_DUE_DAYS = 7;

type SendFn = (to: string, subject: string, message: string, headerTitle?: string) => Promise<{ success: boolean; error?: string }>;

interface ContractorRef {
  contractorId: string;
  companyName: string;
  name: string;
  email: string;
  phone?: string | null;
}

function assertNoUrl(label: string, text: string): void {
  if (NO_URL_RE.test(text)) {
    // A URL in a work order email violates design D7 — fail loud, never send.
    throw new Error(`work-order-email: refusing to send ${label} containing a URL (D7)`);
  }
}

function formatDay(d: Date | null | undefined): string {
  return d ? new Date(d).toISOString().slice(0, 10) : 'as soon as possible';
}

/** First name of the contractor contact for the greeting. */
function firstName(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.split(' ')[0]! : '';
}

// ---------------------------------------------------------------------------
// Template rendering (pure — unit-testable, no I/O)
// ---------------------------------------------------------------------------

/** RFQ subject (design §Email 1): "Property NI — Quotation request for work order <id>". */
export function renderRfqSubject(args: { workOrder: Pick<WorkOrder, 'workOrderId'> }): string {
  const subject = `Property NI — Quotation request for work order ${args.workOrder.workOrderId}`;
  assertNoUrl('rfq subject', subject);
  return subject;
}

/** No explicit deadline on the row (legacy data) → RFQs default to +7 days, matching the send-time default. */
const RFQ_DEFAULT_DUE_DAYS = 7;

/** RFQ body: direct quotation request — reference, full description, due date, organisation contact (design §Email 1). */
export function renderRfqBody(args: {
  workOrder: Pick<WorkOrder, 'description' | 'workOrderId' | 'quotesDue'>;
  organisationName: string;
  contractor: ContractorRef;
  openedBy?: string;
}): string {
  const dueDate = args.workOrder.quotesDue ?? new Date(Date.now() + RFQ_DEFAULT_DUE_DAYS * 24 * 60 * 60 * 1000);
  const due = formatDay(dueDate);
  const contactLine = args.openedBy ? `Contact point: ${args.organisationName} — ${args.openedBy}` : `Contact point: ${args.organisationName}`;
  const body = [
    `Dear ${firstName(args.contractor.name)},`,
    '',
    `${args.organisationName} would like to request your quotation for the following work:`,
    '',
    `Work order reference: ${args.workOrder.workOrderId}`,
    `Description: ${args.workOrder.description}`,
    `Quotation due: ${due}`,
    contactLine,
    '',
    'To proceed, please reply with your total amount and a brief breakdown of the quoted price, by the due date above.',
    'If you are unable to submit a quotation for this work, a short reply letting us know is appreciated.',
    '',
    `Regards`,
    args.organisationName,
  ].join('\n');
  assertNoUrl('rfq body', body);
  return body;
}

/** Assignment notice (design §Email 2): work assigned + scope summary. */
export function renderAssignment(args: {
  workOrder: Pick<WorkOrder, 'description' | 'workOrderId'>;
  organisationName: string;
  contractor: ContractorRef;
}): { subject: string; message: string } {
  const subject = `Work assigned: ${args.workOrder.description} (${args.workOrder.workOrderId})`;
  const message = [
    `Dear ${firstName(args.contractor.name)},`,
    '',
    `Your quotation for work order ${args.workOrder.workOrderId} has been accepted. The work is now assigned to ${args.contractor.companyName}.`,
    '',
    `Description: ${args.workOrder.description}`,
    '',
    'Please confirm a start time at your earliest convenience.',
    '',
    `Regards`,
    args.organisationName,
  ].join('\n');
  assertNoUrl('assignment subject', subject);
  assertNoUrl('assignment body', message);
  return { subject, message };
}

/** Invoice request (design §Email 3): issue your invoice, with a suggested due date. */
export function renderInvoiceRequest(args: {
  workOrder: Pick<WorkOrder, 'description' | 'workOrderId'>;
  organisationName: string;
  contractor: ContractorRef;
  suggestedDueDate?: Date;
}): { subject: string; message: string } {
  const subject = `Invoice request — completed work ${args.workOrder.workOrderId}`;
  const message = [
    `Dear ${firstName(args.contractor.name)},`,
    '',
    `The following work has been completed and we would like you to raise your invoice for it.`,
    '',
    `Work order reference: ${args.workOrder.workOrderId}`,
    `Description: ${args.workOrder.description}`,
    `Suggested payment due date: ${formatDay(args.suggestedDueDate)}`,
    '',
    'Please send the invoice to the contact details on your quotation request.',
    '',
    `Regards`,
    args.organisationName,
  ].join('\n');
  assertNoUrl('invoice-request subject', subject);
  assertNoUrl('invoice-request body', message);
  return { subject, message };
}

// ---------------------------------------------------------------------------
// Send + NotificationLog (T2 tolerance: failures logged + recorded, never thrown)
// ---------------------------------------------------------------------------

async function recordNotificationLog(args: {
  recipientEmail: string;
  eventType: string;
  message: string;
  success: boolean;
  organizationId: string | null;
}): Promise<void> {
  try {
    await tenantDb.notificationLog.create({
      data: {
        recipientEmail: args.recipientEmail,
        eventType: args.eventType,
        message: args.message.slice(0, 2000),
        status: args.success ? 'SENT' : 'FAILED',
        organizationId: args.organizationId,
      },
    });
  } catch (err) {
    // Logging the log must never mask the outcome — best effort only.
    logger.warn({ err, eventType: args.eventType }, '[WorkOrderEmail] NotificationLog write failed');
  }
}

/**
 * Send one branded work order email and record a NotificationLog row.
 * Swallows SMTP failures (T2 tolerance) and reports them via `sent`.
 */
async function sendAndRecord(args: {
  to: string;
  subject: string;
  message: string;
  eventType: string;
  organizationId: string | null;
  workOrderId: string;
  /** Branded header strip (per event type). */
  headerTitle?: string;
  sendFn?: SendFn;
}): Promise<boolean> {
  const send = args.sendFn ?? (sendEmail as SendFn);
  let success = false;
  let error: unknown;
  try {
    const result = await send(args.to, args.subject, args.message, args.headerTitle);
    success = result.success;
    if (!result.success) error = result.error;
  } catch (err) {
    success = false;
    error = err;
  }

  if (!success) {
    logger.warn(
      { err: error, to: args.to, eventType: args.eventType, workOrderId: args.workOrderId },
      '[WorkOrderEmail] send failed (transition unaffected)',
    );
  } else {
    logger.info({ to: args.to, eventType: args.eventType, workOrderId: args.workOrderId }, '[WorkOrderEmail] sent');
  }

  await recordNotificationLog({
    recipientEmail: args.to,
    eventType: args.eventType,
    message: `${args.subject} — ${args.message}`,
    success,
    organizationId: args.organizationId,
  });
  return success;
}

/**
 * Send the RFQ to ONE contractor (design §Email 1). Returns {sent}.
 * SMTP failure → FAILED log row + `sent: false`, no throw.
 */
export async function sendRfqToContractor(args: {
  workOrder: WorkOrder;
  contractor: ContractorRef;
  organisationName: string;
  quotesDue?: Date | null;
  openedBy?: string;
  sendFn?: SendFn;
}): Promise<{ sent: boolean }> {
  const subject = renderRfqSubject({ workOrder: args.workOrder });
  const body = renderRfqBody({
    workOrder: args.workOrder,
    organisationName: args.organisationName,
    contractor: args.contractor,
    openedBy: args.openedBy,
  });
  const sent = await sendAndRecord({
    to: args.contractor.email,
    subject,
    message: body,
    eventType: 'work_order_rfq',
    organizationId: args.workOrder.organizationId,
    workOrderId: args.workOrder.workOrderId,
    headerTitle: HEADER_RFQ,
    sendFn: args.sendFn,
  });
  return { sent };
}

// ---------------------------------------------------------------------------
// Dispatcher seam — wired into WorkOrderService by the transition route via
// setWorkOrderEmailDispatcher. Runs AFTER the committed transaction; reads use
// the env platform context (read-only-safe per RLS), NotificationLog writes
// inherit the route's tenant RLS context. Returns {sent, failed} counts.
// ---------------------------------------------------------------------------

const EVENT_TYPES: Record<WorkOrderEmailEvent['event'], string> = {
  rfq: 'work_order_rfq',
  assignment: 'work_order_assignment',
  invoice_request: 'work_order_invoice_request',
};

export type WorkOrderEmailSummary = { sent: number; failed: number };

export async function sendWorkOrderEmailEvent(evt: WorkOrderEmailEvent): Promise<WorkOrderEmailSummary> {
  // Reload the committed row (post-tx state is authoritative). If it vanished
  // between commit and dispatch, dispatch nothing — at-most-once by design.
  const row = await withEnvPlatformContext(() =>
    tenantDb.workOrder.findUnique({ where: { workOrderId: evt.workOrder.workOrderId } }),
  );
  if (!row) {
    logger.warn({ workOrderId: evt.workOrder.workOrderId }, '[WorkOrderEmail] dispatch skipped — row not found after commit');
    return { sent: 0, failed: 0 };
  }

  const organisationName = (
    await withEnvPlatformContext(() =>
      tenantDb.organization.findUnique({ where: { id: row.organizationId }, select: { name: true } }),
    )
  )?.name ?? 'Property NI';

  // Resolve the targeted contractors from the global directory in one read.
  const contractors = await withEnvPlatformContext(() =>
    tenantDb.contractors.findMany({
      where: { contractorId: { in: evt.contractorIds } },
      select: { contractorId: true, companyName: true, name: true, email: true, phone: true },
    }),
  );

  let sent = 0;
  let failed = 0;

  for (const contractor of contractors) {
    const ref = contractor as unknown as ContractorRef;
    let ok = false;
    if (evt.event === 'rfq') {
      ({ sent: ok } = await sendRfqToContractor({
        workOrder: row,
        contractor: ref,
        organisationName,
        quotesDue: evt.quotesDue ?? row.quotesDue,
        openedBy: row.openedBy,
      }));
    } else if (evt.event === 'assignment') {
      const { subject, message } = renderAssignment({ workOrder: row, organisationName, contractor: ref });
      ok = await sendAndRecord({
        to: ref.email,
        subject,
        message,
        eventType: EVENT_TYPES.assignment,
        organizationId: row.organizationId,
        workOrderId: row.workOrderId,
        headerTitle: HEADER_ASSIGNMENT,
      });
    } else {
      // invoice_request (COMPLETE): suggested due date = +7 days from dispatch.
      const suggestedDueDate = new Date(Date.now() + DEFAULT_INVOICE_DUE_DAYS * 24 * 60 * 60 * 1000);
      const { subject, message } = renderInvoiceRequest({ workOrder: row, organisationName, contractor: ref, suggestedDueDate });
      ok = await sendAndRecord({
        to: ref.email,
        subject,
        message,
        eventType: EVENT_TYPES.invoice_request,
        organizationId: row.organizationId,
        workOrderId: row.workOrderId,
        headerTitle: HEADER_INVOICE,
      });
    }
    if (ok) sent++;
    else failed++;
  }

  const skipped = evt.contractorIds.length - contractors.length;
  if (skipped > 0) {
    logger.warn(
      { workOrderId: row.workOrderId, requested: evt.contractorIds, found: contractors.length },
      '[WorkOrderEmail] some contractor ids were not in the global directory — skipped',
    );
  }

  return { sent, failed };
}
