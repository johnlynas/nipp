/**
 * Shared shapes + formatters for the work order pages (admin CRUD + tenant
 * read-only). Kept framework-free so both server-rendered wrappers and the
 * client panels can import the same types.
 */

import { WORK_ORDER_STATES } from '@/lib/work-order-state';

export type WorkOrderStateValue = (typeof WORK_ORDER_STATES)[number];

/** Contractor fields joined onto quotes / invoices / assignments by the detail routes. */
export interface ContractorBrief {
  name: string;
  companyName: string;
  email?: string | null;
  phone?: string | null;
  type?: string | null;
}

export interface WorkOrderRow {
  workOrderId: string;
  description: string;
  openedBy: string;
  contractorId: string | null;
  quotesDue: string | null;
  state: WorkOrderStateValue;
  organizationId: string;
  /** Joined by the admin list route only. */
  organizationName?: string;
  /** Open quote count (joined in list routes). */
  quoteCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkOrderNote {
  workOrderNoteId: string;
  workOrderId: string;
  note: string;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Decimal columns serialize to JSON strings from Prisma. */
export interface WorkOrderQuote {
  quoteId: string;
  workOrderId: string;
  contractorId: string;
  quoteLink: string | null;
  description: string | null;
  price: string | null;
  dueDate: string;
  state: 'OPENED' | 'ACCEPTED' | 'REJECTED' | 'CLOSED';
  createdAt: string;
  updatedAt: string;
  contractor?: ContractorBrief;
}

export interface WorkOrderInvoice {
  invoiceId: string;
  invoiceDate: string;
  workOrderId: string;
  contractorId: string;
  invoiceLink: string | null;
  price: string;
  dueDate: string;
  createdAt: string;
  updatedAt: string;
  contractor?: ContractorBrief;
}

export interface WorkOrderDetail extends WorkOrderRow {
  /** Org display name (admin detail route only). */
  organizationName?: string;
  notes: WorkOrderNote[];
  quotes: WorkOrderQuote[];
  invoice: WorkOrderInvoice | null;
  /**
   * Assigned contractor record (null pre-assignment). Joined by the admin
   * detail route; the tenant detail route resolves it from `contractorId` +
   * quotes, or renders the name from the assigned quote.
   */
  assignedContractor?: ContractorBrief | null;
}

export function workOrderDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
}

/** £ formatting for Decimal(string) columns from Prisma. */
export function workOrderMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const num = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });
}

/** yyyy-mm-dd for date inputs (local noon — stable round-trip through the API). */
export function toLocalInputDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Date input value → ISO timestamp (local noon) for the API. */
export function localInputDateToIso(value: string): Date {
  return new Date(`${value}T12:00:00`);
}

/**
 * Advisory overdue check — shared by the admin list and detail surfaces.
 * A quote deadline only matters while the work order is out for quotes.
 */
export function isQuoteOverdue(
  row: { state: WorkOrderStateValue; quotesDue: string | null },
  now: number,
): boolean {
  return row.state === 'OUT_FOR_QUOTES' && !!row.quotesDue && new Date(row.quotesDue).getTime() < now;
}

const QUOTE_STATE_META: Record<WorkOrderQuote['state'], { label: string; bg: string; text: string }> = {
  OPENED: { label: 'Open', bg: '#EEF2FA', text: 'var(--color-navy-850)' },
  ACCEPTED: { label: 'Accepted', bg: 'var(--color-success-tint)', text: 'var(--color-success)' },
  REJECTED: { label: 'Rejected', bg: 'var(--color-danger-tint)', text: 'var(--color-danger-ink)' },
  CLOSED: { label: 'Closed', bg: 'var(--color-canvas-subtle)', text: 'var(--color-slate-500)' },
};

export function quoteStateMeta(state: WorkOrderQuote['state']) {
  return QUOTE_STATE_META[state] ?? QUOTE_STATE_META.OPENED;
}
