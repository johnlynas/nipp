'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { logClientError } from '@/lib/client-error-logger';
import { ConfirmDialog } from '@/components/dashboard/ConfirmDialog';
import { type WorkOrderNote, workOrderDate } from './work-order-shared';
import { apiFetch } from '@/lib/api-client';

const NOTE_MAX = 2000;

function noteTime(createdAt: string): string {
  const d = new Date(createdAt);
  return `${workOrderDate(createdAt)} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * Work order notes — shared read list with admin add/delete controls.
 * The tenant detail page passes `interactive={false}` for a pure read view;
 * whether a work order is even editable is owned by the parent (terminal-state
 * rule from lib/work-order-state), not this component.
 */
export function WorkOrderNotesPanel({
  notes,
  interactive,
  workOrderId,
  onAdded,
  onDeleted,
  onFailed,
}: {
  notes: WorkOrderNote[];
  interactive: boolean;
  /** Required when interactive — the panel's own mutations need it. */
  workOrderId?: string;
  onAdded?: () => void;
  onDeleted?: (id: string) => void;
  onFailed?: (msg: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingNote, setDeletingNote] = useState<WorkOrderNote | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const newestFirst = [...notes].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const fail = (msg: string) => {
    console.error('Work order note operation failed:', msg);
    logClientError(msg, 'work-order-notes', interactive ? 'mutate' : 'fetch');
    onFailed?.(msg);
  };

  const handleAdd = async () => {
    if (!workOrderId || !draft.trim()) return;
    setSaving(true);
    try {
      const res = await apiFetch('/api/admin/work-order-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workOrderId, note: draft.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to add note');
      }
      setDraft('');
      onAdded?.(); // parent refetches — notes list updates
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Failed to add note');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingNote) return;
    setDeleteBusy(true);
    try {
      const res = await apiFetch(`/api/admin/work-order-notes/${deletingNote.workOrderNoteId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete note');
      }
      setDeletingNote(null);
      onDeleted?.(deletingNote.workOrderNoteId); // parent refetches
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Failed to delete note');
      setDeleteBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {newestFirst.length === 0 ? (
        <p className="py-2 text-sm text-slate-400">
          {interactive ? 'No notes yet — record progress below.' : 'No notes recorded.'}
        </p>
      ) : (
        <div className="divide-y divide-slate-100">
          {newestFirst.map((n) => (
            <div key={n.workOrderNoteId} className="flex items-start gap-3 px-1 py-3">
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap break-words text-sm" style={{ color: 'var(--color-navy-850)' }}>{n.note}</p>
                <p className="mt-1 text-xs text-slate-400">{noteTime(n.createdAt)}</p>
              </div>
              {interactive && (
                <button
                  onClick={() => setDeletingNote(n)}
                  title="Delete note"
                  aria-label="Delete note"
                  className="rounded p-1.5 text-slate-400 transition-colors hover:bg-danger-tint hover:text-danger-ink"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {interactive && (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, NOTE_MAX))}
            rows={3}
            placeholder="Record a note on this work order…"
            aria-label="New note"
            className="w-full resize-y rounded border px-3 py-2 text-sm bg-white focus:outline-none"
            style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs tabular-nums text-slate-400">{draft.length}/{NOTE_MAX}</span>
            <button
              onClick={handleAdd}
              disabled={saving || !draft.trim()}
              className="inline-flex items-center gap-1.5 rounded border-transparent px-3 py-2 text-sm font-medium text-accent-ink transition-colors hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              <Plus className="h-4 w-4" />
              {saving ? 'Adding…' : 'Add Note'}
            </button>
          </div>
        </div>
      )}

      {/* Per-note delete confirm */}
      <ConfirmDialog
        isOpen={deletingNote !== null}
        onClose={() => !deleteBusy && setDeletingNote(null)}
        onConfirm={handleDelete}
        title="Delete Note"
        message={deletingNote ? `Delete this note? It reads “${deletingNote.note.length > 80 ? `${deletingNote.note.slice(0, 80)}…` : deletingNote.note}”. This cannot be undone.` : ''}
        confirmLabel={deleteBusy ? 'Deleting…' : 'Delete'}
        variant="danger"
      />
    </div>
  );
}
