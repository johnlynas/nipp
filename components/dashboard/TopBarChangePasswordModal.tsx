/**
 * TopBarChangePasswordModal — "Change Password" modal for local (email &
 * password) users, opened from the top-bar identity chip.
 *
 * Same visual family as TopBarUserInfoModal (Modal shell, slate labels, accent
 * primary). Client-side guardrail: the two fields must match before OK is
 * submitted; a mismatch is reported in place and the modal stays open. The
 * actual update — hashing + User.passwordHash / credential Account row — is
 * POST /api/auth/password, which serves only the signed-in user's own record.
 */

'use client';

import { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Modal } from '@/components/dashboard/Modal';
import { apiFetch } from '@/lib/api-client';
import { logClientError } from '@/lib/client-error-logger';

interface TopBarChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function TopBarChangePasswordModal({ isOpen, onClose }: TopBarChangePasswordModalProps) {
  // Remount the form on every open so both fields start empty.
  const [formKey, setFormKey] = useState(0);
  useEffect(() => {
    if (isOpen) setFormKey((k) => k + 1);
  }, [isOpen]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Change Password" size="sm">
      <ChangePasswordForm key={formKey} onDone={onClose} />
    </Modal>
  );
}

/**
 * Password input with inline Eye/EyeOff visibility toggle. The toggle is
 * aria-labeled + pressed so screen readers announce state; it idles (dimmed)
 * while the field is empty — nothing to reveal.
 */
function PasswordInput({
  id,
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
  invalid,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  invalid: boolean;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>{label}</label>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus={autoFocus}
          autoComplete="new-password"
          placeholder={placeholder}
          className="w-full rounded border bg-white py-2 pl-3 pr-9 text-sm focus:outline-none"
          style={{ borderColor: invalid ? 'var(--color-danger)' : 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={visible}
          disabled={!value}
          className={`absolute inset-y-0 right-0 flex w-9 items-center justify-center transition-colors ${
            value ? 'text-slate-400 hover:text-slate-600 cursor-pointer' : 'text-slate-300/70'
          }`}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  // The two values must match; typing either one clears the mismatch so the
  // correction is felt immediately.
  const handleFieldChange = (setter: (v: string) => void) => (value: string) => {
    setter(value);
    setMismatch((m) => (m ? false : m));
  };

  const handleOk = async () => {
    if (password !== confirm) {
      setApiError(null);
      setMismatch(true);
      return; // stay open — nothing was sent
    }
    if (!password.trim()) {
      setApiError('Enter a new password.');
      return;
    }

    setSaving(true);
    setMismatch(false);
    setApiError(null);
    try {
      const res = await apiFetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || 'Failed to update password');
      }

      // Server confirmed the hash is stored — "Password updated", then close.
      setSuccess(true);
      setTimeout(onDone, 900);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update password';
      console.error('Failed to change password:', err);
      logClientError(message, 'auth', 'change-password');
      setApiError(message);
    } finally {
      setSaving(false);
    }
  };

  if (success) {
    return (
      <div className="py-6 text-center" role="status">
        <p className="text-sm font-medium" style={{ color: 'var(--color-navy-850)' }}>
          Password updated
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {mismatch && (
        <p role="alert" className="rounded border p-2 text-sm" style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}>
          Passwords do not match.
        </p>
      )}
      {apiError && !mismatch && (
        <p role="alert" className="rounded border p-2 text-sm" style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}>
          {apiError}
        </p>
      )}

      <PasswordInput
        id="change-pw-new"
        label="New Password"
        value={password}
        onChange={handleFieldChange(setPassword)}
        placeholder="New password"
        autoFocus
        invalid={mismatch}
      />
      <PasswordInput
        id="change-pw-confirm"
        label="Confirm Password"
        value={confirm}
        onChange={handleFieldChange(setConfirm)}
        placeholder="Repeat new password"
        invalid={mismatch}
      />

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onDone}
          disabled={saving}
          className="rounded border px-4 py-2 text-sm font-medium transition-colors hover:bg-slate-50 disabled:opacity-50"
          style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleOk}
          disabled={saving || !password || !confirm}
          className="rounded px-4 py-2 text-sm font-medium text-accent-ink transition-colors hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: 'var(--color-accent)' }}
        >
          {saving ? 'Saving…' : 'OK'}
        </button>
      </div>
    </div>
  );
}
