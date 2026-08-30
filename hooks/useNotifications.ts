/**
 * useNotifications — SSE connection and notification ticker hook.
 *
 * Connects to /api/notifications/stream, maintains a queue of notifications
 * displayed as a footer ticker in the admin dashboard. Auto-dismisses after
 * 10 seconds, or stays persistent for ERROR/CRITICAL priority.
 *
 * Uses a singleton connection pattern to prevent multiple SSE connections
 * from the same browser tab (fixes 429 errors from React StrictMode and
 * multiple component mounts).
 */

import { useEffect, useCallback, useSyncExternalStore } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const EMPTY_NOTIFICATIONS_STATE = {
  notifications: [] as Notification[],
  isConnected: false,
};


export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  priority: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  source?: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Priority helpers
// ---------------------------------------------------------------------------

export const PRIORITY_COLORS: Record<string, string> = {
  INFO: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
  WARNING: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
  ERROR: 'text-red-400 bg-red-500/10 border-red-500/30',
  CRITICAL: 'text-red-400 bg-red-500/20 border-red-500/50',
};

export function getPriorityIcon(priority: string): string {
  switch (priority) {
    case 'CRITICAL': return '🔴';
    case 'ERROR': return '⚠️';
    case 'WARNING': return '🟡';
    default: return 'ℹ️';
  }
}

// ---------------------------------------------------------------------------
// Singleton SSE Store — shared across all useNotifications() consumers
// ---------------------------------------------------------------------------

interface NotificationStore {
  notifications: NotificationItem[];
  isConnected: boolean;
}

let store: NotificationStore = {
  notifications: [],
  isConnected: false,
};

const SERVER_SNAPSHOT: NotificationStore = {
  notifications: [],
  isConnected: false,
};

const listeners = new Set<() => void>();
let connectionStarted = false;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const dismissTimers = new Map<string, ReturnType<typeof setTimeout>>();

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function scheduleDismiss(id: string, priority: string) {
  // Clear any existing timer for this notification
  const existing = dismissTimers.get(id);
  if (existing) {
    clearTimeout(existing);
    dismissTimers.delete(id);
  }

  // Only auto-dismiss INFO and WARNING; ERROR/CRITICAL stay until manually dismissed
  if (priority === 'INFO' || priority === 'WARNING') {
    const timer = setTimeout(() => {
      store = {
        ...store,
        notifications: store.notifications.filter((n) => n.id !== id),
      };
      dismissTimers.delete(id);
      emitChange();
    }, 10_000);

    dismissTimers.set(id, timer);
  }
}

function startConnection() {
  if (connectionStarted) return;
  connectionStarted = true;

  const connect = async () => {
    try {
      const response = await fetch('/api/notifications/stream', { credentials: 'include' });

      if (!response.ok) {
        console.warn(`[useNotifications] SSE connection failed: ${response.status}`);
        store = { ...store, isConnected: false };
        emitChange();

        // Reset connectionStarted so we can retry
        connectionStarted = false;
        reconnectAttempts += 1;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30_000);
        reconnectTimeout = setTimeout(() => {
          startConnection();
        }, delay);
        return;
      }

      // Reset reconnect attempts on successful connection
      reconnectAttempts = 0;
      store = { ...store, isConnected: true };
      emitChange();

      const reader = response.body?.getReader();
      if (!reader) {
        console.error('[useNotifications] SSE: no response body');
        store = { ...store, isConnected: false };
        emitChange();
        connectionStarted = false;
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);

          try {
            const notification: NotificationItem = JSON.parse(data);

            // Check if notification already exists (deduplicate)
            const exists = store.notifications.find((n) => n.id === notification.id);
            if (exists) continue;

            // Add notification, keep max 20
            const updated = [...store.notifications, notification].slice(-20);
            store = {
              ...store,
              notifications: updated,
            };
            emitChange();

            scheduleDismiss(notification.id, notification.priority);
          } catch (_err) {
            console.error('[useNotifications] Failed to parse SSE message:', _err);
          }
        }
      }

      reader.releaseLock();

      // Connection ended normally — mark as disconnected and attempt reconnect
      store = { ...store, isConnected: false };
      emitChange();
      connectionStarted = false;

      // Reconnect after a short delay
      reconnectTimeout = setTimeout(() => {
        startConnection();
      }, 2000);
    } catch {
      console.warn('[useNotifications] SSE connection error, reconnecting...');
      store = { ...store, isConnected: false };
      emitChange();
      connectionStarted = false;

      reconnectAttempts += 1;
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30_000);
      reconnectTimeout = setTimeout(() => {
        startConnection();
      }, delay);
    }
  };

  connect();
}

// Start the singleton connection on module load (browser only)
if (typeof window !== 'undefined') {
  // Delay initial connection slightly to allow React StrictMode double-mount to settle
  setTimeout(() => {
    startConnection();
  }, 100);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useNotifications() {
  // Subscribe to the singleton store
  const { notifications, isConnected } = useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    () => store,
    () => SERVER_SNAPSHOT // Cached server snapshot
  );

  // Ensure connection is started (in case module load timing was off)
  useEffect(() => {
    if (typeof window !== 'undefined' && !connectionStarted) {
      startConnection();
    }
  }, []);

  // Manual dismiss
  const dismissNotification = useCallback((id: string) => {
    store = {
      ...store,
      notifications: store.notifications.filter((n) => n.id !== id),
    };
    emitChange();

    const timer = dismissTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      dismissTimers.delete(id);
    }
  }, []);

  // Clear all notifications
  const clearNotifications = useCallback(() => {
    store = {
      ...store,
      notifications: [],
    };
    emitChange();

    for (const timer of dismissTimers.values()) {
      clearTimeout(timer);
    }
    dismissTimers.clear();
  }, []);

  return {
    notifications,
    isConnected,
    dismissNotification,
    clearNotifications,
  };
}
