/**
 * Work order state machine — single source of truth.
 *
 * Dependency-free on purpose: `services/work-order-service.ts` (server) imports
 * these, and the Phase 4 client components import them too, so every surface
 * derives its action buttons from ONE map instead of a duplicated constant.
 * Kept deliberately free of Prisma/logger/DB imports so it is safe to bundle
 * into client chunks — server code types `WorkOrderState` as `string`.
 */

/** Valid work order state values — mirrors the Prisma WorkOrderState enum. */
export const WORK_ORDER_STATES = [
  'CREATED',
  'OUT_FOR_QUOTES',
  'QUOTES_IN',
  'CONTRACTOR_ASSIGNED',
  'STARTED',
  'COMPLETE',
  'INVOICED',
  'FINISHED',
  'CLOSED',
] as const;

export type WorkOrderState = (typeof WORK_ORDER_STATES)[number];

/** State machine: legal one-hop transitions (design doc §State Machine). */
export const WORK_ORDER_TRANSITIONS: Record<WorkOrderState, WorkOrderState[]> = {
  CREATED: ['OUT_FOR_QUOTES', 'CLOSED'],
  OUT_FOR_QUOTES: ['QUOTES_IN', 'CONTRACTOR_ASSIGNED', 'CLOSED'],
  QUOTES_IN: ['CONTRACTOR_ASSIGNED', 'CLOSED'],
  CONTRACTOR_ASSIGNED: ['STARTED'],
  STARTED: ['COMPLETE'],
  COMPLETE: ['INVOICED'],
  INVOICED: ['FINISHED'],
  FINISHED: [],
  CLOSED: [],
};

/** Terminal states — no notes, no further actions (design §State Machine). */
export const WORK_ORDER_TERMINAL_STATES: WorkOrderState[] = ['FINISHED', 'CLOSED'];

/** Quotation lifecycle — mirrors the Prisma QuotationState enum (single source). */
export const QUOTE_STATES = ['OPENED', 'ACCEPTED', 'REJECTED', 'CLOSED'] as const;

/** Work order states that may solicit (create) new quotes. */
export const QUOTABLE_WORK_ORDER_STATES: readonly string[] = ['CREATED', 'OUT_FOR_QUOTES', 'QUOTES_IN'];

/* ---------------------------------------------------------------------------
 * Presentation labels + state badge colors (incumbent token vocabulary)
 * ------------------------------------------------------------------------ */

export const WORK_ORDER_STATE_LABELS: Record<WorkOrderState, string> = {
  CREATED: 'Created',
  OUT_FOR_QUOTES: 'Out for Quotes',
  QUOTES_IN: 'Quotes In',
  CONTRACTOR_ASSIGNED: 'Contractor Assigned',
  STARTED: 'Started',
  COMPLETE: 'Complete',
  INVOICED: 'Invoiced',
  FINISHED: 'Finished',
  CLOSED: 'Closed',
};

type BadgeTone = { bg: string; text: string };

const TOKEN_BG: Record<WorkOrderState, BadgeTone> = {
  // Neutral navy tint — new work order, nothing notable yet.
  CREATED: { bg: '#EEF2FA', text: 'var(--color-navy-850)' },
  // Amber = active solicitation / in-flight work (matches the warning tint system).
  OUT_FOR_QUOTES: { bg: 'var(--color-warning-tint)', text: 'var(--color-warning-ink)' },
  QUOTES_IN: { bg: '#EEF2FA', text: 'var(--color-navy-850)' },
  CONTRACTOR_ASSIGNED: { bg: 'var(--color-warning-tint)', text: 'var(--color-warning-ink)' },
  STARTED: { bg: 'var(--color-success-tint)', text: 'var(--color-success)' },
  COMPLETE: { bg: 'var(--color-success-tint)', text: 'var(--color-success)' },
  INVOICED: { bg: '#EEF2FA', text: 'var(--color-navy-850)' },
  FINISHED: { bg: 'var(--color-canvas-subtle)', text: 'var(--color-slate-600)' },
  // Muted = early closure, no further motion (same convention as StatusBadge INACTIVE).
  CLOSED: { bg: 'var(--color-canvas-subtle)', text: 'var(--color-slate-500)' },
};

export function workOrderStateTone(state: WorkOrderState): BadgeTone {
  return TOKEN_BG[state] ?? TOKEN_BG.CREATED;
}
