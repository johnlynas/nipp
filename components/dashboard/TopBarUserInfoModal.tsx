/**
 * TopBarUserInfoModal — "User Info" modal opened from the top-bar identity chip.
 *
 * Shows what session truth already has (name, email) plus the user's active
 * organization, fetched on open from /api/auth/me (best-effort: the modal is
 * fully usable if the request fails or the user has no org). Identity is shown
 * exactly once — as Name/Email rows — since the chip already carries the name.
 */

'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/dashboard/Modal';

interface TopBarUserInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  name?: string;
  email?: string;
}

export function TopBarUserInfoModal({ isOpen, onClose, name, email }: TopBarUserInfoModalProps) {
  const [orgName, setOrgName] = useState<string | null>(null);
  // 'OIDC' (verified Google identity) | 'Local'; null until /api/auth/me lands —
  // shown as the em-dash placeholder for the modal's brief loading window.
  const [userType, setUserType] = useState<'OIDC' | 'Local' | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { organizationName?: string; userType?: 'OIDC' | 'Local' } | null) => {
        if (!cancelled) {
          if (data?.organizationName) setOrgName(data.organizationName);
          if (data?.userType === 'OIDC' || data?.userType === 'Local') setUserType(data.userType);
        }
      })
      .catch(() => {
        // No org shown — session fields above are enough.
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="User Info" size="sm">
      <dl>
        <div className="flex items-center justify-between gap-4 py-3">
          <dt className="text-sm text-slate-500">Name</dt>
          <dd className="min-w-0 truncate text-right text-sm font-medium text-slate-900">{name || '—'}</dd>
        </div>
        <div className="flex items-center justify-between gap-4 py-3">
          <dt className="text-sm text-slate-500">Email</dt>
          <dd className="min-w-0 truncate text-right text-sm font-medium text-slate-900">{email || '—'}</dd>
        </div>
        <div className="flex items-center justify-between gap-4 py-3">
          <dt className="text-sm text-slate-500">User Type</dt>
          <dd className="min-w-0 truncate text-right text-sm font-medium text-slate-900">{userType ?? '—'}</dd>
        </div>
        <div className="flex items-center justify-between gap-4 py-3">
          <dt className="text-sm text-slate-500">Organization</dt>
          <dd className="min-w-0 truncate text-right text-sm font-medium text-slate-900">{orgName || '—'}</dd>
        </div>
      </dl>
    </Modal>
  );
}
