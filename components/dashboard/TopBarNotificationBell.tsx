/**
 * TopBarNotificationBell — notification bell with unread badge for the top bar.
 *
 * Sits far right of the top bar on all admin pages. Clicking opens a dropdown
 * mirroring the footer ticker: every active SSE notification is listed with
 * its priority, source, and age; items can be dismissed individually or all at
 * once. Shares the singleton SSE store with the footer ticker via
 * useNotifications() — no separate connection is opened.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { Bell, XCircle } from 'lucide-react';
import { useNotifications } from '@/hooks/useNotifications';

const TONE_CLASSES: Record<string, string> = {
  INFO: 'text-slate-600 bg-slate-100',
  WARNING: 'text-warning-ink bg-warning-tint',
  ERROR: 'text-danger-ink bg-danger-tint',
  CRITICAL: 'text-white bg-danger',
  CALENDAR: 'text-success bg-success-tint',
  JOB: 'text-slate-700 bg-canvas-subtle',
};

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function TopBarNotificationBell() {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { notifications, isConnected, dismissNotification, clearNotifications } = useNotifications();

  // Close on outside click / Escape.
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

  const hasUnread = notifications.length > 0;

  return (
    <div className="relative" ref={anchorRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={hasUnread ? `Notifications: ${notifications.length} active` : 'Notifications: none'}
        aria-haspopup="true"
        aria-expanded={open}
        className={`relative rounded-full p-2 transition-colors ${
          open
            ? 'bg-slate-100 text-slate-900'
            : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
        }`}
      >
        <Bell className="h-[18px] w-[18px]" />
        {hasUnread && (
          <span
            className="absolute -top-0.5 -right-0.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white"
            aria-hidden="true"
          >
            {notifications.length}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={menuRef}
          role="dialog"
          aria-label="Active notifications"
          className="absolute right-0 top-full z-50 mt-2 w-[360px] max-w-[calc(100vw-3rem)] rounded-lg border bg-white shadow-lg"
          style={{ borderColor: 'var(--color-slate-200)' }}
        >
          <div
            className="flex items-center justify-between border-b px-4 py-3"
            style={{ borderColor: 'var(--color-slate-100)' }}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-900">Notifications</span>
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  isConnected ? 'bg-success' : 'bg-danger animate-pulse'
                }`}
                aria-label={isConnected ? 'Connected' : 'Reconnecting'}
              />
            </div>
            {hasUnread && (
              <button
                type="button"
                onClick={clearNotifications}
                className="text-xs font-medium text-slate-500 hover:text-slate-900 transition-colors"
              >
                Clear all
              </button>
            )}
          </div>

          {hasUnread ? (
            <ul className="max-h-[320px] overflow-y-auto py-1">
              {notifications.map((n) => (
                <li
                  key={n.id}
                  className="flex items-start gap-3 px-4 py-2.5 hover:bg-canvas-subtle transition-colors"
                >
                  <span
                    className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide shrink-0 ${TONE_CLASSES[n.priority] || TONE_CLASSES.INFO}`}
                  >
                    {n.priority}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{n.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{n.message}</p>
                    {n.source && (
                      <p className="mt-0.5 truncate text-[11px] text-slate-400">
                        {n.source} · {timeAgo(n.createdAt)}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => dismissNotification(n.id)}
                    className="mt-0.5 rounded p-1 text-slate-400 hover:bg-danger-tint hover:text-danger-ink transition-colors shrink-0"
                    aria-label={`Dismiss: ${n.title}`}
                  >
                    <XCircle className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-6 text-center text-sm text-slate-400">No active notifications</p>
          )}

        </div>
      )}
    </div>
  );
}
