'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, ExternalLink, CalendarClock } from 'lucide-react';
import { logClientError } from '@/lib/client-error-logger';
import { PageSkeleton } from '@/components/dashboard/PageSkeleton';
import { WorkOrderStateBadge } from '@/components/dashboard/WorkOrderStateBadge';
import { QuoteTable } from '@/components/dashboard/QuoteTable';
import { WorkOrderNotesPanel } from '@/components/dashboard/WorkOrderNotesPanel';
import {
  type WorkOrderDetail,
  workOrderDate,
  workOrderMoney,
  isQuoteOverdue,
} from '@/components/dashboard/work-order-shared';
import { apiFetch } from '@/lib/api-client';

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border p-5" style={{ borderColor: 'var(--color-slate-200)', backgroundColor: 'var(--color-canvas)' }}>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--color-slate-500)' }}>{title}</h2>
      {children}
    </section>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <span className="min-w-0 break-words text-right" style={{ color: 'var(--color-navy-850)' }}>{children}</span>
    </div>
  );
}

/**
 * Tenant work order detail — read-only. No buttons of any kind: the page is a
 * GET fetch plus rendering (notes panel in non-interactive mode, quote table
 * without selection). The assigned contractor is resolved from the ACCEPTED
 * quote (the service marks exactly one at assignment time), falling back to
 * the row's contractorId.
 */
export default function TenantWorkOrderDetailClient({ id }: { id: string }) {
  const [detail, setDetail] = useState<WorkOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Active org from session first, then localStorage fallback.
      let orgId: string | null = null;
      try {
        const meRes = await apiFetch('/api/auth/me');
        if (meRes.ok) {
          const me = await meRes.json();
          if (me.activeOrganizationId) orgId = me.activeOrganizationId;
        }
      } catch { /* fall through */ }
      if (!orgId) orgId = localStorage.getItem('nipp-active-org-id');
      if (!orgId) {
        if (!cancelled) { setError('No organization selected'); setLoading(false); }
        return;
      }

      try {
        const res = await apiFetch(`/api/organizations/${orgId}/work-orders/${id}`);
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to load work order');
        }
        const data: WorkOrderDetail = await res.json();
        if (!cancelled) setDetail(data);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to load work order';
        console.error('Failed to load work order:', err);
        logClientError(message, 'tenant-work-order-detail', 'fetch');
        setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Auto-dismiss error banner.
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(timer);
  }, [error]);

  if (loading) return <PageSkeleton rows={6} cols={4} />;

  if (notFound || (!detail && error === null)) {
    return (
      <div className="flex items-center justify-center py-16">
        <p style={{ color: 'var(--color-slate-700)' }}>Work order not found.</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex items-center justify-center py-16">
        <p style={{ color: 'var(--color-slate-700)' }}>{error ?? 'Work order not found.'}</p>
      </div>
    );
  }

  // Assigned contractor — from the ACCEPTED quote, else the row's contractorId.
  const accepted = detail.quotes.find((q) => q.state === 'ACCEPTED');
  const assigned =
    accepted?.contractor ??
    (detail.contractorId ? detail.quotes.find((q) => q.contractorId === detail.contractorId)?.contractor : undefined);

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
        href="/dashboard/tenant/work-orders"
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

      {/* Meta — same rows as the admin detail, minus organization (same org by construction) */}
      <SectionCard title="Details">
        <div className="space-y-3">
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
            {assigned ? `${assigned.companyName} — ${assigned.name}` : 'Unassigned'}
          </FieldRow>
        </div>
      </SectionCard>

      {/* Notes — read-only */}
      <SectionCard title="Notes">
        <WorkOrderNotesPanel notes={detail.notes} interactive={false} />
      </SectionCard>

      {/* Quotations — read-only */}
      <SectionCard title="Quotations">
        {detail.quotes.length === 0 ? (
          <p className="py-1 text-sm text-slate-400">No quotations have been requested yet — an RFQ from your platform team invites contractors to quote.</p>
        ) : (
          <QuoteTable quotes={detail.quotes} />
        )}
      </SectionCard>

      {/* Invoice — read-only */}
      <SectionCard title="Invoice">
        {detail.invoice ? (
          <div className="space-y-3">
            <FieldRow label="Total">{workOrderMoney(detail.invoice.price)}</FieldRow>
            <FieldRow label="Invoice date">{workOrderDate(detail.invoice.invoiceDate)}</FieldRow>
            <FieldRow label="Due date">{workOrderDate(detail.invoice.dueDate)}</FieldRow>
            {detail.invoice.contractor && (
              <FieldRow label="Contractor">{detail.invoice.contractor.companyName}</FieldRow>
            )}
            {detail.invoice.invoiceLink && (
              <FieldRow label="Invoice">
                <a
                  href={detail.invoice.invoiceLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"
                  style={{ color: 'var(--color-accent)' }}
                >
                  Open invoice <ExternalLink className="h-3 w-3" />
                </a>
              </FieldRow>
            )}
          </div>
        ) : (
          <p className="py-1 text-sm text-slate-400">No invoice recorded yet.</p>
        )}
      </SectionCard>
    </div>
  );
}
