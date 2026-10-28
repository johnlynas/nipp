/**
 * TopBarUserInfoModal — "User Info" modal opened from the top-bar identity chip.
 *
 * Shows what session truth already has (name, email) plus the user's active
 * organization, fetched on open from /api/auth/me (best-effort: the modal is
 * fully usable if the request fails or the user has no org).
 */

'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/dashboard/Modal';

interface TopBarUserInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  name?: string;
  email?: string;
  avatarInitials: string;
}

export function TopBarUserInfoModal({ isOpen, onClose, name, email, avatarInitials }: TopBarUserInfoModalProps) {
  const [orgName, setOrgName] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { organizationName?: string } | null) => {
        if (!cancelled && data?.organizationName) setOrgName(data.organizationName);
      })
      .catch(() => {
        // No org shown — session fields above are enough.
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const displayName = name || email || 'User';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="User Info" size="sm">
      <div className="flex items-center gap-4 pb-4">
        <span
          aria-hidden="true"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-navy-850 text-base font-semibold text-white"
        >
          {avatarInitials}
        </span>
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-slate-900">{displayName}</p>
          {name && email ? (
            <p className="truncate text-sm text-slate-500">{email}</p>
          ) : null}
        </div>
      </div>
      <dl className="divide-y" style={{ borderColor: 'var(--color-slate-100)' }}>
        <div className="flex items-center justify-between gap-4 py-3">
          <dt className="text-sm text-slate-500">Name</dt>
          <dd className="min-w-0 truncate text-right text-sm font-medium text-slate-900">{name || '—'}</dd>
        </div>
        <div className="flex items-center justify-between gap-4 py-3" style={{ borderColor: 'var(--color-slate-100)' }}>
          <dt className="text-sm text-slate-500">Email</dt>
          <dd className="min-w-0 truncate text-right text-sm font-medium text-slate-900">{email || '—'}</dd>
        </div>
        <div className="flex items-center justify-between gap-4 py-3" style={{ borderColor: 'var(--color-slate-100)' }}>
          <dt className="text-sm text-slate-500">Organization</dt>
          <dd className="min-w-0 truncate text-right text-sm font-medium text-slate-900">{orgName || '—'}</dd>
        </div>
      </dl>
    </Modal>
  );
}
