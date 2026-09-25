'use client';

import { Modal } from './Modal';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
}

export function ConfirmDialog({
  isOpen, onClose, onConfirm, title, message,
  confirmLabel = 'Confirm', cancelLabel = 'Cancel', variant = 'default',
}: ConfirmDialogProps) {
  const handleConfirm = () => { onConfirm(); onClose(); };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <p className="mb-6 text-sm" style={{ color: 'var(--color-slate-500)' }}>{message}</p>
      <div className="flex justify-end gap-3">
        <button
          onClick={onClose}
          className="rounded border px-4 py-2 text-sm font-medium transition-colors hover:bg-slate-50"
          style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
        >
          {cancelLabel}
        </button>
        <button
          onClick={handleConfirm}
          className="rounded px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
          style={{ backgroundColor: variant === 'danger' ? 'var(--color-danger)' : 'var(--color-accent)' }}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
