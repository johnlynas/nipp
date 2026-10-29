/**
 * TopBarUserIdentityChip — identity chip + account menu for the top bar.
 *
 * Sits left of the notification bell on all admin pages: avatar with initials,
 * full name, and email underneath (hidden at narrow widths). Identity comes
 * straight from the BetterAuth session atom — no network round trip, so it is
 * available before /api/auth/me resolves. Left-click opens a dropdown with
 * "User Info", "Change Password" (local users only) and logout; outside click
 * / Escape close it. The menu mirrors TopBarNotificationBell's anchor + panel
 * idiom.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, KeyRound, LogOut, UserRound } from 'lucide-react';
import { signOutUser, useSession } from '@/lib/auth-client';
import { TopBarUserInfoModal } from '@/components/dashboard/TopBarUserInfoModal';
import { TopBarChangePasswordModal } from '@/components/dashboard/TopBarChangePasswordModal';

function initialsOf(name: string | null | undefined, email: string | null | undefined): string {
  const source = (name && name.trim()) || (email || '').split('@')[0] || '?';
  const parts = source.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function TopBarUserIdentityChip() {
  const { data: session } = useSession();
  // Session atom returns an untyped payload upstream; mirror the cast used in usePermission.ts.
  const user = (session as { user?: { name?: string | null; email?: string | null } } | null)?.user;
  const name: string | undefined = user?.name ? String(user.name) : undefined;
  const email: string | undefined = user?.email ? String(user.email) : undefined;

  const [open, setOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  // null = unknown (fetch pending/failed) — "Change Password" stays disabled
  // until /api/auth/me proves this is a credential account. Safe default:
  // never expose the action to a user it would refuse anyway.
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Best-effort credential check for the dropdown (same source of truth as
  // /api/auth/password). One fetch per mount; failure leaves the item off.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { hasPassword?: boolean } | null) => {
        if (!cancelled && typeof data?.hasPassword === 'boolean') setHasPassword(data.hasPassword);
      })
      .catch(() => {
        // Leave unknown — item stays disabled.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Name is display-first; email doubles as fallback and secondary line.
  const displayName = name || email || 'User';
  const avatarInitials = initialsOf(name, email);

  // Close on outside click / Escape — same idiom as the notification bell.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  const handleLogout = async () => {
    setOpen(false);
    const result = await signOutUser();
    if (result.error) {
      console.error('Logout failed:', result.error);
      return;
    }
    // Full page reload clears SPA state and lands on the login screen.
    window.location.replace('/login?t=' + Date.now());
  };

  return (
    <div className="relative" ref={anchorRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Account menu for ${displayName}`}
        className={`flex items-center gap-2 rounded-md pr-1.5 transition-colors cursor-pointer ${
          open ? 'bg-slate-100' : 'hover:bg-slate-100'
        }`}
      >
        <span
          aria-hidden="true"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-850 text-xs font-semibold text-white shrink-0"
        >
          {avatarInitials}
        </span>
        <div className="hidden sm:block leading-tight text-left">
          <p className="max-w-[140px] truncate text-sm font-medium text-slate-900">{displayName}</p>
          {name && email ? (
            <p className="max-w-[160px] truncate text-xs text-slate-500">{email}</p>
          ) : null}
        </div>
        {open ? (
          <ChevronDown className={`hidden sm:block h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-200`} aria-hidden="true" />
        ) : (
          <ChevronUp className={`hidden sm:block h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-200`} aria-hidden="true" />
        )}
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Account menu"
          className="absolute left-0 top-full z-50 mt-2 w-60 rounded-lg border bg-white shadow-lg"
          style={{ borderColor: 'var(--color-slate-200)' }}
        >
          <div className="p-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setInfoOpen(true);
              }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-canvas-subtle transition-colors cursor-pointer"
            >
              <UserRound className="h-4 w-4 shrink-0 text-slate-400" />
              User Info
            </button>
            <button
              type="button"
              role="menuitem"
              aria-disabled={!hasPassword}
              title={hasPassword ? undefined : 'Not available for Google sign-in accounts'}
              onClick={() => {
                if (!hasPassword) return; // disabled row — no action for OIDC users
                setOpen(false);
                setPasswordOpen(true);
              }}
              className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-medium transition-colors ${
                hasPassword
                  ? 'text-slate-700 hover:bg-canvas-subtle cursor-pointer'
                  : 'cursor-not-allowed text-slate-300'
              }`}
            >
              <KeyRound className="h-4 w-4 shrink-0 text-slate-400" />
              Change Password
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={handleLogout}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-danger-tint hover:text-danger-ink transition-colors cursor-pointer"
            >
              <LogOut className="h-4 w-4 shrink-0 text-slate-400" />
              Log out
            </button>
          </div>
        </div>
      )}

      <TopBarUserInfoModal
        isOpen={infoOpen}
        onClose={() => setInfoOpen(false)}
        name={name}
        email={email}
      />
      <TopBarChangePasswordModal isOpen={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </div>
  );
}
