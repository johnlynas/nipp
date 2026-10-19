'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { ArrowLeft, CalendarClock, Mail, Play, Send, UserCheck, XCircle, CheckCircle2 } from 'lucide-react';
import { logClientError } from '@/lib/client-error-logger';
import { PageSkeleton } from '@/components/dashboard/PageSkeleton';
import { Modal } from '@/components/dashboard/Modal';
import { ConfirmDialog } from '@/components/dashboard/ConfirmDialog';
import { MultiSelect } from '@/components/dashboard/MultiSelect';
import { QuoteTable } from '@/components/dashboard/QuoteTable';
import { WorkOrderNotesPanel } from '@/components/dashboard/WorkOrderNotesPanel';
import { WorkOrderStateBadge } from '@/components/dashboard/WorkOrderStateBadge';
import { WORK_ORDER_TRANSITIONS, WORK_ORDER_TERMINAL_STATES, type WorkOrderState } from '@/lib/work-order-state';
import {
  type WorkOrderDetail,
  type WorkOrderQuote,
  workOrderDate,
  workOrderMoney,
  isQuoteOverdue,
  quoteStateMeta,
  toLocalInputDate,
  localInputDateToIso,
} from '@/components/dashboard/work-order-shared';

const inputClass = 'w-full rounded border px-3 py-2 text-sm bg-white focus:outline-none';
const inputStyle = { borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' } as const;

/** Shared section shell — white card, slate rule, uppercase section heading. */
function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border p-5" style={{ borderColor: 'var(--color-slate-200)', backgroundColor: 'var(--color-canvas)' }}>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--color-slate-500)' }}>{title}</h2>
      {children}
    </section>
  );
}

/** Label/value meta row (slate labels, navy values) — the detail header's vocabulary. */
function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <span className="min-w-0 break-words text-right" style={{ color: 'var(--color-navy-850)' }}>{children}</span>
    </div>
  );
}

/** UI copy for transition destinations (display only — the map stays in lib). */
/** No state transitions back to CREATED, so it is not a possible destination. */
type ActionDest = Exclude<WorkOrderState, 'CREATED'>;

const ACTION_LABELS: Record<ActionDest, string> = {
  OUT_FOR_QUOTES: 'Send RFQ',
  QUOTES_IN: 'Mark Quotes In',
  CONTRACTOR_ASSIGNED: 'Assign Contractor',
  STARTED: 'Start Work',
  COMPLETE: 'Mark Complete',
  INVOICED: 'Mark Invoiced',
  FINISHED: 'Finish (payment made)',
  CLOSED: 'Close Work Order',
};

const ACTION_ICONS: Record<Exclude<WorkOrderState, 'CREATED'>, React.ComponentType<{ className?: string }>> = {
  OUT_FOR_QUOTES: Send,
  QUOTES_IN: Mail,
  CONTRACTOR_ASSIGNED: UserCheck,
  STARTED: Play,
  COMPLETE: CheckCircle2,
  INVOICED: CheckCircle2,
  FINISHED: CheckCircle2,
  CLOSED: XCircle,
};

/** One-line confirm copy for the simple (no-dialog-option) transitions. */
const CONFIRM_TEXT: Partial<Record<WorkOrderState, (d: WorkOrderDetail) => string>> = {
  QUOTES_IN: (d) => `Mark quotations as received for ${d.description}? You can then assign a contractor.`,
  STARTED: (_d) => 'Start work? The assigned contractor will be notified.',
  COMPLETE: () => 'Confirm the work is finished? The work order moves to billing.',
  INVOICED: (d) => `${d.invoice ? `Invoice ${workOrderDate(d.invoice.dueDate)} recorded. ` : ''}Mark this work order as invoiced?`,
};

/**
 * Super-admin work order detail. Every action button is derived from the shared
 * WORK_ORDER_TRANSITIONS map (lib/work-order-state) — illegal states render no
 * affordance, so the UI cannot ask for a hop the service would 409.
 */
export default function WorkOrderDetailClient({ id }: { id: string }) {
  const [detail, setDetail] = useState<WorkOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Transition in flight — disables the whole action bar while a POST settles.
  const [busyTo, setBusyTo] = useState<ActionDest | null>(null);
  // Simple confirm dialog ("Start work on …?").
  const [confirmTo, setConfirmTo] = useState<ActionDest | null>(null);
  // Dedicated option dialogs (bodies land in Tasks 4–5).
  const [rfqOpen, setRfqOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  // Send-RFQ form — default deadline is +7 days (design D8: advisory, not enforced).
  const [rfqContractorIds, setRfqContractorIds] = useState<string[]>([]);
  const [rfqDue, setRfqDue] = useState(() => toLocalInputDate(new Date(Date.now() + 7 * 86400_000)));
  // Contractor picker source — fetched lazily the first time the dialog opens.
  const [contractorOptions, setContractorOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [contractorsLoading, setContractorsLoading] = useState(false);
  const [contractorsError, setContractorsError] = useState<string | null>(null);

  useEffect(() => {
    if (!rfqOpen || contractorOptions.length > 0 || contractorsLoading) return;
    let cancelled = false;
    (async () => {
      setContractorsLoading(true);
      setContractorsError(null);
      try {
        const res = await fetch('/api/dashboard/admin/contractors?pageSize=100');
        if (!res.ok) throw new Error('Could not load the contractor list');
        const data = await res.json();
        if (!cancelled) {
          setContractorOptions((data.items || []).map((c: { contractorId: string; companyName: string; name: string }) => ({
            id: c.contractorId,
            label: `${c.companyName} — ${c.name}`,
          })));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not load the contractor list';
        if (!cancelled) setContractorsError(message);
      } finally {
        if (!cancelled) setContractorsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [rfqOpen, contractorOptions.length, contractorsLoading]);

  const closeRfqDialog = () => {
    setRfqOpen(false);
    setRfqContractorIds([]);
  };

  // Assign dialog — one quote selected for acceptance (server accepts it and
  // rejects/closes the rest).
  const [assignQuoteId, setAssignQuoteId] = useState<string | null>(null);

  const closeAssignDialog = () => {
    setAssignOpen(false);
    setAssignQuoteId(null);
  };

  const load = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/work-orders/${id}`, { signal: abortRef.current.signal });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load work order');
      }
      setDetail(await res.json());
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const message = err instanceof Error ? err.message : 'Failed to load work order';
      console.error('Failed to load work order:', err);
      logClientError(message, 'work-order-detail', 'fetch');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Auto-dismiss error banner.
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(timer);
  }, [error]);

  /** Shared transition submit — refetches the full detail on success (quotes,
   * invoice and state may all have changed server-side). */
  const runTransition = async (to: ActionDest, payload: Record<string, unknown>) => {
    setBusyTo(to);
    try {
      const res = await fetch(`/api/admin/work-orders/${id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, ...payload }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Transition failed');
      }
      // Closing the option dialogs; simpleConfirmTo already closes on confirm.
      setRfqOpen(false);
      setAssignOpen(false);
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Transition failed';
      console.error('Work order transition failed:', err);
      logClientError(message, 'work-order-detail', 'transition');
      setError(message);
    } finally {
      setBusyTo(null);
    }
  };

  const handleRfqSubmit = () => {
    if (!detail || rfqContractorIds.length === 0) return;
    runTransition('OUT_FOR_QUOTES', {
      contractorIds: rfqContractorIds,
      quotesDue: localInputDateToIso(rfqDue).toISOString(),
    });
  };

  const handleAssignSubmit = () => {
    if (!detail || !assignQuoteId) return;
    runTransition('CONTRACTOR_ASSIGNED', { quoteId: assignQuoteId });
  };

  const handleAction = (to: ActionDest) => {
    if (!detail || busyTo) return;
    switch (to) {
      case 'OUT_FOR_QUOTES':
        setRfqOpen(true);
        break;
      case 'CONTRACTOR_ASSIGNED':
        setAssignOpen(true);
        break;
      case 'FINISHED':
        // Payment confirmation dialog.
        setConfirmTo('FINISHED');
        break;
      default:
        setConfirmTo(to);
    }
  };

  const confirmMessage = (to: ActionDest): string => {
    if (!detail) return '';
    switch (to) {
      case 'CLOSED':
        return `Close this work order early? Open quotations will be closed and no further state changes are possible.`;
      case 'FINISHED':
        return `Confirm payment has been made and finish ${detail.description}? A receipt is emailed to the contractor. The work order is finished — no further changes are possible.`;
      default: {
        const fn = CONFIRM_TEXT[to];
        return fn ? fn(detail) : `Move this work order to ${ACTION_LABELS[to]}?`;
      }
    }
  };

  if (loading && !detail) {
    return <PageSkeleton rows={6} cols={4} />;
  }

  if (!detail) {
    return (
      <div>
        {error && (
          <div className="mb-4 rounded border border-danger-border bg-danger-tint p-3 text-sm text-danger-ink" role="alert">
            {error}
          </div>
        )}
        <p className="text-sm text-slate-500">Work order not found.</p>
      </div>
    );
  }

  const now = Date.now();
  const quotesOverdue = isQuoteOverdue(detail, now);

  // Action set computed from the fetched state (not a client-side duplicate).
  // No transition target is ever CREATED, so narrowing once here is safe.
  let actions: Array<{ to: ActionDest; label: string }> = WORK_ORDER_TRANSITIONS[detail.state].map((to) => {
    const dest = to as ActionDest;
    return { to: dest, label: ACTION_LABELS[dest] };
  });
  // The service requires a recorded invoice for COMPLETE → INVOICED; hiding the
  // button avoids a guaranteed 409 (the record form lands in Plan 3).
  if (!detail.invoice) actions = actions.filter((a) => a.to !== 'INVOICED');
  // Primary styling: the last listed transition is the state's forward step,
  // except Close — it keeps the neutral danger-confirm style of incumbents.
  const primaryTo = actions.length ? (actions[actions.length - 1].to === 'CLOSED' && actions.length > 1 ? null : actions[actions.length - 1].to) : null;

  return (
    <div className="space-y-6">
      {/* Error banner */}
      {error && (
        <div className="rounded border border-danger-border bg-danger-tint p-3 text-sm text-danger-ink" role="alert">
          {error}
        </div>
      )}

      {/* Back link */}
      <Link
        href="/dashboard/admin/work-orders"
        className="inline-flex items-center gap-1.5 text-sm font-medium transition-colors hover:underline"
        style={{ color: 'var(--color-slate-500)' }}
      >
        <ArrowLeft className="h-4 w-4" />
        Back to work orders
      </Link>

      {/* Header */}
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <WorkOrderStateBadge state={detail.state} />
          <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight" style={{ color: 'var(--color-slate-900)' }}>
            {detail.description}
          </h1>
        </div>
        <p className="mt-1 break-words text-sm" style={{ color: 'var(--color-slate-500)' }}>{detail.description}</p>
      </div>

      {/* Action bar — derived from WORK_ORDER_TRANSITIONS[detail.state] */}
      {actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          {actions.map((a) => {
            const Icon = ACTION_ICONS[a.to];
            const isPrimary = a.to === primaryTo;
            return (
              <button
                key={a.to}
                onClick={() => handleAction(a.to)}
                disabled={busyTo !== null}
                className={`inline-flex items-center gap-1.5 rounded border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                  isPrimary ? 'border-transparent text-accent-ink hover:opacity-90' : 'hover:bg-slate-50'
                }`}
                style={isPrimary
                  ? { backgroundColor: 'var(--color-accent)', borderColor: 'var(--color-accent)' }
                  : { borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
              >
                <Icon className="h-4 w-4" />
                {busyTo === a.to ? `${a.label}…` : a.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Meta */}
      <SectionCard title="Details">
        <div className="space-y-3">
          {detail.organizationName && (
            <FieldRow label="Organization">{detail.organizationName}</FieldRow>
          )}
          <FieldRow label="Opened by">{detail.openedBy} ({workOrderDate(detail.createdAt)})</FieldRow>
          <FieldRow label="Quotes due">
            {detail.quotesDue ? (
              <span className="inline-flex items-center gap-1.5" style={{ color: quotesOverdue ? 'var(--color-warning-ink)' : 'var(--color-navy-850)' }}>
                <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                {workOrderDate(detail.quotesDue)}{quotesOverdue ? ' · Overdue' : ''}
              </span>
            ) : (
              <span style={{ color: 'var(--color-slate-400)' }}>—</span>
            )}
          </FieldRow>
          <FieldRow label="Assigned contractor">
            {detail.assignedContractor ? `${detail.assignedContractor.companyName} — ${detail.assignedContractor.name}` : 'Unassigned'}
          </FieldRow>
        </div>
      </SectionCard>

      {/* Notes — interactive on active work orders, read-only once terminal */}
      <SectionCard title="Notes">
        <WorkOrderNotesPanel
          notes={detail.notes}
          interactive={!WORK_ORDER_TERMINAL_STATES.includes(detail.state)}
          workOrderId={detail.workOrderId}
          onAdded={() => { load(); }}
          onDeleted={() => { load(); }}
          onFailed={(msg) => { console.error(msg); logClientError(msg, 'work-order-detail', 'notes'); setError(msg); }}
        />
      </SectionCard>

      {/* Quotation/invoice management in Plans 2–3 */}
      <SectionCard title="Quotations">
        <p className="py-1 text-sm text-slate-400">Quote entry lands in Plan 2.</p>
      </SectionCard>

      <SectionCard title="Invoice">
        <p className="py-1 text-sm text-slate-400">Invoice recording lands in Plan 3.</p>
      </SectionCard>

      {/* Simple transition confirm (Start / Complete / Invoiced / Payment) */}
      {confirmTo && (
        <ConfirmDialog
          isOpen
          onClose={() => !busyTo && setConfirmTo(null)}
          onConfirm={() => runTransition(confirmTo, confirmTo === 'FINISHED' ? { paid: true } : {})}
          title={ACTION_LABELS[confirmTo]}
          message={confirmMessage(confirmTo)}
          confirmLabel={busyTo ? `${ACTION_LABELS[confirmTo]}…` : ACTION_LABELS[confirmTo]}
          variant={confirmTo === 'CLOSED' ? 'danger' : 'default'}
        />
      )}

      {/* Send-RFQ dialog — contractor multi-select + due date */}
      <Modal isOpen={rfqOpen} onClose={closeRfqDialog} title="Send RFQ" size="md">
        <div className="space-y-4">
          <p className="text-sm" style={{ color: 'var(--color-slate-500)' }}>
            Select the contractors to invite and a quotation deadline.
          </p>

          {contractorsError ? (
            <p className="rounded border border-danger-border bg-danger-tint p-3 text-sm text-danger-ink" role="alert">
              {contractorsError}
            </p>
          ) : contractorsLoading ? (
            <div className="h-[38px] animate-pulse rounded border px-3 py-2" style={{ borderColor: 'var(--color-slate-200)', backgroundColor: 'var(--color-canvas-subtle)' }} />
          ) : (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-navy-850)' }}>Contractors</label>
                <MultiSelect
                  options={contractorOptions}
                  selected={rfqContractorIds}
                  onChange={setRfqContractorIds}
                  placeholder={`Select contractors… (${rfqContractorIds.length} selected)`}
                  searchPlaceholder="Search by company or name…"
                  aria-label="Select contractors"
                />
              </div>
              <div>
                <label htmlFor="wo-rfq-due" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-navy-850)' }}>Quotes due</label>
                <input
                  id="wo-rfq-due"
                  type="date"
                  min={toLocalInputDate(new Date())}
                  value={rfqDue}
                  onChange={(e) => setRfqDue(e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                />
              </div>
              <p className="text-xs" style={{ color: 'var(--color-slate-500)' }}>
                RFQ emails are sent to the selected contractors without portal links — they reply by phone or email. The deadline is advisory; work orders can be assigned at any time.
              </p>
            </>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={closeRfqDialog} disabled={busyTo !== null} className="rounded border px-4 py-2 text-sm font-medium transition-colors hover:bg-slate-50" style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}>
              Cancel
            </button>
            <button
              onClick={handleRfqSubmit}
              disabled={busyTo !== null || rfqContractorIds.length === 0 || contractorsLoading || !!contractorsError}
              className="rounded px-4 py-2 text-sm font-medium text-accent-ink transition-colors hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              {busyTo === 'OUT_FOR_QUOTES' ? 'Sending…' : `Send RFQ to ${rfqContractorIds.length || ''} contractor${rfqContractorIds.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </Modal>

      {/* Assign-contractor dialog — quote comparison, one accepted */}
      <Modal isOpen={assignOpen} onClose={closeAssignDialog} title="Assign Contractor" size="lg">
        <div className="space-y-4">
          <p className="text-sm" style={{ color: 'var(--color-slate-500)' }}>
            Choose one received quotation — the chosen contractor is accepted, all others rejected.
          </p>

          {detail.quotes.length === 0 ? (
            <p className="py-4 text-sm" style={{ color: 'var(--color-slate-500)' }}>
              No quotations have been recorded yet — send an RFQ to invite contractors, or close this work order.
            </p>
          ) : (() => {
            const eligible = detail.quotes.filter((q) => q.price !== null && (q.state === 'OPENED' || q.state === 'ACCEPTED'));
            return (
              <>
                <QuoteTable quotes={detail.quotes} selectedQuoteId={assignQuoteId} onSelect={setAssignQuoteId} />
                {eligible.length === 0 && (
                  <p className="text-sm" style={{ color: 'var(--color-slate-500)' }}>
                    Quotations are out{detail.quotesDue ? ` at ${workOrderDate(detail.quotesDue)}` : ''} — no priced quotation has been recorded yet. Once a price is on file the row becomes selectable here; quote entry ships with the quotations panel.
                  </p>
                )}
              </>
            );
          })()}

          {detail.quotes.length > 0 && (
            <p className="text-xs" style={{ color: 'var(--color-slate-500)' }}>
              The chosen contractor will be notified by email; other quotations are marked rejected.
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={closeAssignDialog} disabled={busyTo !== null} className="rounded border px-4 py-2 text-sm font-medium transition-colors hover:bg-slate-50" style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}>
              Cancel
            </button>
            <button
              onClick={handleAssignSubmit}
              disabled={busyTo !== null || !assignQuoteId}
              className="rounded px-4 py-2 text-sm font-medium text-accent-ink transition-colors hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              {busyTo === 'CONTRACTOR_ASSIGNED' ? 'Assigning…' : 'Assign Contractor'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
