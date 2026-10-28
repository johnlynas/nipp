'use client';

import { useState, useEffect, useCallback } from 'react';
import { Pencil, Trash2, Plus, ExternalLink } from 'lucide-react';
import { Modal } from './Modal';
import { ConfirmDialog } from './ConfirmDialog';
import { MultiSelect } from './MultiSelect';
import {
  type WorkOrderQuote,
  type WorkOrderStateValue,
  workOrderDate,
  workOrderMoney,
  quoteStateMeta,
  toLocalInputDate,
  localInputDateToIso,
} from './work-order-shared';
import { apiFetch } from '@/lib/api-client';

/**
 * Quotations section on the super-admin work order detail page. Compact
 * comparison table (price ascending, unpriced last — display-only). Editing is
 * in place via expanded rows (no second modal stack): an OPENED row's pencil
 * swaps that <tr> for a three-field form; add-quote and delete use the
 * incumbent Modal / ConfirmDialog vocabulary. All mutations refetch through the
 * parent's load() — the server owns quote state (auto-hops, duplicates, 409s).
 */

interface WorkOrderQuotationsPanelProps {
  workOrderId: string;
  quotes: WorkOrderQuote[];
  workOrderState: WorkOrderStateValue;
  /** Terminal states → no controls anywhere in the section. */
  disabled?: boolean;
  /** Parent's load() — refetch after any mutation. */
  refetch: () => Promise<void>;
  /** Parent error banner (verbatim server messages). */
  onFailed: (message: string) => void;
}

interface EditForm {
  price: string;
  description: string;
  quoteLink: string;
}

const inputClass = 'w-full rounded border px-3 py-2 text-sm bg-white focus:outline-none';
const inputStyle = { borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' } as const;
const labelText = 'mb-1 block text-sm font-medium';

/** Single source for the edit/delete row affordances — decided rows are immutable. */
function canEditQuote(row: WorkOrderQuote): boolean {
  return row.state === 'OPENED';
}

export function WorkOrderQuotationsPanel({
  workOrderId,
  quotes,
  workOrderState,
  disabled = false,
  refetch,
  onFailed,
}: WorkOrderQuotationsPanelProps) {
  const sorted = [...quotes].sort((a, b) => {
    const pa = a.price === null ? Number.POSITIVE_INFINITY : Number(a.price);
    const pb = b.price === null ? Number.POSITIVE_INFINITY : Number(b.price);
    return pa - pb;
  });

  const received = quotes.filter((q) => q.price !== null).length;

  // ── Expanded-row edit state ──────────────────────────────────────
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EditForm>({ price: '', description: '', quoteLink: '' });
  // Snapshot at expand time — the Escape discard check diffs against this.
  const [initial, setInitial] = useState<EditForm>({ price: '', description: '', quoteLink: '' });
  const [saving, setSaving] = useState(false);

  const editingRow = editingId ? quotes.find((q) => q.quoteId === editingId) ?? null : null;

  const startEdit = (row: WorkOrderQuote) => {
    if (saving) return;
    const next: EditForm = { price: row.price ?? '', description: row.description ?? '', quoteLink: row.quoteLink ?? '' };
    setEditingId(row.quoteId);
    setForm(next);
    setInitial(next);
  };

  const cancelEdit = useCallback(() => {
    if (saving) return;
    setEditingId(null);
  }, [saving]);

  // Escape closes editing — with a discard confirm only when the form is dirty.
  const [discardOpen, setDiscardOpen] = useState(false);
  useEffect(() => {
    if (!editingRow || discardOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      const dirty =
        form.price !== initial.price || form.description !== initial.description || form.quoteLink !== initial.quoteLink;
      if (dirty) setDiscardOpen(true);
      else cancelEdit();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [editingRow, discardOpen, form, initial, cancelEdit]);

  const handleSave = async () => {
    if (!editingRow) return;
    const priceText = form.price.trim();
    if (priceText !== '') {
      const price = Number(priceText);
      if (!Number.isFinite(price) || price <= 0) {
        onFailed('Price must be greater than zero');
        return;
      }
    }
    setSaving(true);
    try {
      // description / quoteLink always sent (empty string normalizes to null).
      // Price: fill is accepted; a received price can never be cleared, so an
      // emptied field keeps the stored value — never send a clear.
      const payload: Record<string, unknown> = {
        description: form.description.trim(),
        quoteLink: form.quoteLink.trim(),
      };
      if (priceText !== '' || editingRow.price !== null) {
        payload.price = priceText === '' ? Number(editingRow.price) : Number(priceText);
      }
      const res = await apiFetch(`/api/admin/quotes/${editingRow.quoteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save quotation');
      }
      setEditingId(null);
      await refetch();
    } catch (err) {
      onFailed(err instanceof Error ? err.message : 'Failed to save quotation');
    } finally {
      setSaving(false);
    }
  };

  // ── Delete state ─────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<WorkOrderQuote | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      const res = await apiFetch(`/api/admin/quotes/${deleteTarget.quoteId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // 409-class (work order moved on): surface verbatim and resync states.
        onFailed(data.error || 'Failed to delete quotation');
        await refetch();
        setDeleteTarget(null);
        return;
      }
      setDeleteTarget(null);
      await refetch();
    } catch {
      onFailed('Failed to delete quotation');
    } finally {
      setDeleteBusy(false);
    }
  };

  // ── Add-quotation dialog (missed contractor, OUT_FOR_QUOTES only) ─
  const [addOpen, setAddOpen] = useState(false);
  const [addContractorIds, setAddContractorIds] = useState<string[]>([]);
  const [addDue, setAddDue] = useState(() => toLocalInputDate(new Date()));
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // Lazy contractor source (same endpoint + label shape as the RFQ dialog),
  // cached at panel level so opening the modal twice is one fetch.
  const [contractorOptions, setContractorOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [contractorsLoading, setContractorsLoading] = useState(false);

  // Lazy load — the guard excludes "already loaded" only. Including
  // `contractorsLoading` here would re-run (and cancel) this very effect when
  // it flips loading, so the fetch resolves to a cancelled scope and the
  // skeleton persists. `cancelled` guards close-then-refetch races instead.
  useEffect(() => {
    if (!addOpen || contractorOptions.length > 0) return;
    let cancelled = false;
    (async () => {
      setContractorsLoading(true);
      try {
        const res = await apiFetch('/api/dashboard/admin/contractors?pageSize=100');
        if (!res.ok) throw new Error('Could not load the contractor list');
        const data = await res.json();
        if (!cancelled) {
          setContractorOptions((data.items || []).map((c: { contractorId: string; companyName: string; name: string }) => ({
            id: c.contractorId,
            label: `${c.companyName} — ${c.name}`,
          })));
        }
      } catch (err) {
        if (!cancelled) setAddError(err instanceof Error ? err.message : 'Could not load the contractor list');
      } finally {
        if (!cancelled) setContractorsLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // deps intentionally exclude `contractorsLoading`: the effect flips it, so
    // depending on it would cancel-and-restart this very fetch on its own state
    // change. The loaded guard + `cancelled` cover the real races.
  }, [addOpen, contractorOptions.length]);

  const openAdd = () => {
    setAddContractorIds([]);
    setAddDue(toLocalInputDate(new Date()));
    setAddError(null);
    setAddOpen(true);
  };

  const closeAdd = () => {
    if (addSaving) return;
    setAddOpen(false);
    setAddContractorIds([]);
  };

  const handleAddSubmit = async () => {
    if (addContractorIds.length !== 1) return;
    setAddSaving(true);
    setAddError(null);
    try {
      const res = await apiFetch('/api/admin/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workOrderId,
          contractorId: addContractorIds[0],
          dueDate: localInputDateToIso(addDue).toISOString(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // Duplicate 422 etc. — verbatim in the modal footer; options recompute
        // from the refetched quotes once the panel reloads.
        setAddError(data.error || 'Failed to record quotation');
        return;
      }
      setAddOpen(false);
      setAddContractorIds([]);
      await refetch();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to record quotation');
    } finally {
      setAddSaving(false);
    }
  };

  const quotedIds = new Set(quotes.map((q) => q.contractorId));
  const addOptions = contractorOptions.filter((o) => !quotedIds.has(o.id));
  const showAddButton = !disabled && workOrderState === 'OUT_FOR_QUOTES';

  return (
    <section className="rounded-lg border p-5" style={{ borderColor: 'var(--color-slate-200)', backgroundColor: 'var(--color-canvas)' }}>
      {/* Heading row — count answers "how many have prices"; add sits right. */}
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--color-slate-500)' }}>Quotations</h2>
          {quotes.length > 0 && (
            <span className="text-xs tabular-nums" style={{ color: 'var(--color-slate-500)' }}>
              {received}/{quotes.length} received
            </span>
          )}
        </div>
        {showAddButton && (
          <button
            onClick={openAdd}
            className="inline-flex items-center gap-1.5 rounded border px-3 py-2 text-sm font-medium transition-colors hover:bg-slate-50"
            style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
          >
            <Plus className="h-4 w-4" />
            Add quotation
          </button>
        )}
      </div>

      {sorted.length === 0 ? (
        <p className="py-2 text-sm" style={{ color: 'var(--color-slate-400)' }}>
          No quotations have been requested — send an RFQ from the actions above.
        </p>
      ) : (
        <div className="overflow-x-auto rounded border" style={{ borderColor: 'var(--color-slate-200)' }}>
          <table className="min-w-full divide-y divide-slate-200">
            <thead>
              <tr className="bg-canvas-subtle">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500" scope="col">Contractor</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500" scope="col">Price</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500" scope="col">State</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500" scope="col">Due date</th>
                {!disabled && (
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500" scope="col">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {sorted.map((q) => {
                const meta = quoteStateMeta(q.state);
                const name = q.contractor?.companyName ?? 'this contractor';

                if (editingId === q.quoteId) {
                  // Expanded row — in-place edit replaces this <tr>'s content.
                  return (
                    <tr key={q.quoteId}>
                      <td colSpan={disabled ? 4 : 5} className="px-4 py-4">
                        <div className="grid gap-4 sm:grid-cols-3">
                          <div>
                            <label htmlFor={`wo-quote-price-${q.quoteId}`} className={labelText} style={{ color: 'var(--color-navy-850)' }}>Price (£)</label>
                            <input
                              id={`wo-quote-price-${q.quoteId}`}
                              type="number"
                              step="0.01"
                              min="0.01"
                              value={form.price}
                              onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                              className={inputClass}
                              style={inputStyle}
                            />
                          </div>
                          <div>
                            <label htmlFor={`wo-quote-desc-${q.quoteId}`} className={labelText} style={{ color: 'var(--color-navy-850)' }}>Breakdown</label>
                            <input
                              id={`wo-quote-desc-${q.quoteId}`}
                              type="text"
                              value={form.description}
                              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                              className={inputClass}
                              style={inputStyle}
                              placeholder="Scope and materials…"
                            />
                          </div>
                          <div>
                            <label htmlFor={`wo-quote-link-${q.quoteId}`} className={labelText} style={{ color: 'var(--color-navy-850)' }}>Quotation link</label>
                            <input
                              id={`wo-quote-link-${q.quoteId}`}
                              type="url"
                              value={form.quoteLink}
                              onChange={(e) => setForm((f) => ({ ...f, quoteLink: e.target.value }))}
                              className={inputClass}
                              style={inputStyle}
                              placeholder="https://…"
                            />
                          </div>
                        </div>
                        {q.price === null && workOrderState === 'OUT_FOR_QUOTES' && (
                          <p className="mt-2 text-xs" style={{ color: 'var(--color-warning-ink)' }}>
                            Recording the first price moves this work order to Quotes In.
                          </p>
                        )}
                        {q.price !== null && form.price.trim() === '' && (
                          <p className="mt-2 text-xs" style={{ color: 'var(--color-slate-500)' }}>
                            Leave blank to keep the current price — a received price cannot be cleared.
                          </p>
                        )}
                        <div className="mt-4 flex justify-end gap-3">
                          <button
                            onClick={cancelEdit}
                            disabled={saving}
                            className="rounded border px-4 py-2 text-sm font-medium transition-colors hover:bg-slate-50"
                            style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleSave}
                            disabled={saving}
                            className="rounded px-4 py-2 text-sm font-medium text-accent-ink transition-colors hover:opacity-90 disabled:opacity-50"
                            style={{ backgroundColor: 'var(--color-accent)' }}
                          >
                            {saving ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr key={q.quoteId}>
                    <td className="min-w-0 px-4 py-3 text-sm">
                      <div className="truncate font-medium" style={{ color: 'var(--color-navy-850)' }}>
                        {q.contractor ? q.contractor.companyName : q.contractorId}
                      </div>
                      {q.contractor && (
                        <div className="text-xs text-slate-500">{q.contractor.name}</div>
                      )}
                      <div className="mt-1 flex items-center gap-3">
                        {q.description ? (
                          <span className="max-w-xs truncate text-xs" style={{ color: 'var(--color-slate-500)' }} title={q.description}>
                            {q.description}
                          </span>
                        ) : null}
                        {q.quoteLink ? (
                          <a
                            href={q.quoteLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex shrink-0 items-center gap-1 text-xs transition-colors hover:underline"
                            style={{ color: 'var(--color-navy-850)' }}
                          >
                            <ExternalLink className="h-3 w-3" />
                            View quote
                          </a>
                        ) : null}
                        {!q.description && !q.quoteLink && (
                          <span className="text-xs" style={{ color: 'var(--color-slate-400)' }}>Not received yet</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-medium tabular-nums" style={{ color: 'var(--color-navy-850)' }}>
                      {workOrderMoney(q.price)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap"
                        style={{ backgroundColor: meta.bg, color: meta.text }}
                      >
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-sm tabular-nums" style={{ color: 'var(--color-navy-850)' }}>
                      {workOrderDate(q.dueDate)}
                    </td>
                    {!disabled && (
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {canEditQuote(q) && (
                            <>
                              <button
                                onClick={() => startEdit(q)}
                                aria-label={`Edit quotation from ${name}`}
                                className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-navy-850"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => setDeleteTarget(q)}
                                aria-label={`Delete quotation from ${name}`}
                                className="rounded p-1.5 text-slate-500 transition-colors hover:bg-danger-tint hover:text-danger-ink"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Escape-discard confirm (only offered when the form changed) */}
      {discardOpen && (
        <ConfirmDialog
          isOpen
          onClose={() => setDiscardOpen(false)}
          onConfirm={() => { setDiscardOpen(false); cancelEdit(); }}
          title="Discard changes?"
          message="This quotation has unsaved edits."
          confirmLabel="Discard"
          variant="danger"
        />
      )}

      {/* Delete confirm — record removal only, no email */}
      {deleteTarget && (
        <ConfirmDialog
          isOpen
          onClose={() => !deleteBusy && setDeleteTarget(null)}
          onConfirm={handleDelete}
          title="Delete quotation"
          message={`Delete ${deleteTarget.contractor?.companyName ?? 'this contractor'}'s quotation? This removes the record only — it does not email the contractor.`}
          confirmLabel={deleteBusy ? 'Deleting…' : 'Delete'}
          variant="danger"
        />
      )}

      {/* Add quotation — contractors already quoted are excluded from options */}
      <Modal isOpen={addOpen} onClose={closeAdd} title="Add Quotation" size="sm">
        <div className="space-y-4">
          <p className="text-sm" style={{ color: 'var(--color-slate-500)' }}>
            Record a quotation from a contractor who was not part of the RFQ.
          </p>

          {addError ? (
            <p className="rounded border border-danger-border bg-danger-tint p-3 text-sm text-danger-ink" role="alert">
              {addError}
            </p>
          ) : contractorsLoading ? (
            <div className="h-[38px] animate-pulse rounded border px-3 py-2" style={{ borderColor: 'var(--color-slate-200)', backgroundColor: 'var(--color-canvas-subtle)' }} />
          ) : addOptions.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--color-slate-400)' }}>Every contractor already has a quotation on this work order.</p>
          ) : (
            <>
              <div>
                <label className={labelText} style={{ color: 'var(--color-navy-850)' }}>Contractor</label>
                <MultiSelect
                  options={addOptions}
                  selected={addContractorIds}
                  onChange={setAddContractorIds}
                  placeholder={`Select a contractor… (${addContractorIds.length} selected)`}
                  searchPlaceholder="Search by company or name…"
                  aria-label="Select contractor"
                />
                {addContractorIds.length > 1 && (
                  <p className="mt-1 text-xs" style={{ color: 'var(--color-warning-ink)' }}>Pick exactly one contractor — select the others' tags to remove them.</p>
                )}
              </div>
              <div>
                <label htmlFor="wo-quote-add-due" className={labelText} style={{ color: 'var(--color-navy-850)' }}>Quotation due</label>
                <input
                  id="wo-quote-add-due"
                  type="date"
                  value={addDue}
                  onChange={(e) => setAddDue(e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                />
                <p className="mt-1 text-xs" style={{ color: 'var(--color-slate-500)' }}>
                  The RFQ emails go only to contractors selected at send time — this just records their quotation.
                </p>
              </div>
            </>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={closeAdd} disabled={addSaving} className="rounded border px-4 py-2 text-sm font-medium transition-colors hover:bg-slate-50" style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}>
              Cancel
            </button>
            <button
              onClick={handleAddSubmit}
              disabled={addSaving || addContractorIds.length !== 1 || contractorsLoading}
              className="rounded px-4 py-2 text-sm font-medium text-accent-ink transition-colors hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              {addSaving ? 'Recording…' : 'Record quotation'}
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
