/**
 * TopBarUserIdentityChip — compact identity chip for the top bar.
 *
 * Sits left of the notification bell on all admin pages: avatar with initials,
 * full name, and email underneath (hidden at narrow widths). Identity comes
 * straight from the BetterAuth session atom — no network round trip, so it is
 * available before /api/auth/me resolves.
 */

'use client';

import { useSession } from '@/lib/auth-client';

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

  if (!user) return null;

  // Name is display-first; email doubles as fallback and secondary line.
  const displayName = name || email || 'User';

  return (
    <div className="flex items-center gap-2 pr-1" title={name ? `${name} · ${email}` : email}>
      <span
        aria-hidden="true"
        className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-850 text-xs font-semibold text-white shrink-0"
      >
        {initialsOf(name, email)}
      </span>
      <div className="hidden sm:block leading-tight">
        <p className="max-w-[140px] truncate text-sm font-medium text-slate-900">{displayName}</p>
        {name && email ? (
          <p className="max-w-[160px] truncate text-xs text-slate-500">{email}</p>
        ) : null}
      </div>
    </div>
  );
}
