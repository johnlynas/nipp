'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { ArrowLeft, CalendarClock } from 'lucide-react';
import { logClientError } from '@/lib/client-error-logger';
import { PageSkeleton } from '@/components/dashboard/PageSkeleton';
import { WorkOrderStateBadge } from '@/components/dashboard/WorkOrderStateBadge';
import {
  type WorkOrderDetail,
  workOrderDate,
  isQuoteOverdue,
} from '@/components/dashboard/work-order-shared';

const inputClass = 'w-full rounded border px-3 py-2 text-sm bg-white focus:outline-none';
const inputStyle = { borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' } as const;
const labelClass = 'mb-1 block text-sm font-medium';
const labelStyle = { color: 'var(--color-navy-850)' } as const;

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
function FieldRow({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 text-sm ${className}`}>
      <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <span className="min-w-0 break-words text-right" style={{ color: 'var(--color-navy-850)' }}>{children}</span>
    </div>
  );
}

/**
 * Super-admin work order detail. The full state-machine UI lands incrementally
 * (action bar, RFQ/assign dialogs, notes; quotation + invoice panels in Plans 2–3);
 * every action is derived from the shared WORK_ORDER_TRANSITIONS map so the page
 * cannot offer a hop the service would reject.
 */
export default function WorkOrderDetailClient({ id }: { id: string }) {
  const [detail, setDetail] = useState<WorkOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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

      {/* Notes land in Task 6; quotation/invoice management in Plans 2–3 */}
      <SectionCard title="Quotations">
        <p className="py-1 text-sm text-slate-400">Quote entry lands in Plan 2.</p>
      </SectionCard>

      <SectionCard title="Invoice">
        <p className="py-1 text-sm text-slate-400">Invoice recording lands in Plan 3.</p>
      </SectionCard>
    </div>
  );
}
