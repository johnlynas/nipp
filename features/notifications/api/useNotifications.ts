import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, useCallback } from 'react';
import { notificationKeys } from './notification.keys';

export interface Notification {
  id: string;
  message: string;
  type: 'info' | 'warning' | 'error';
  read: boolean;
  createdAt: string;
}

async function fetchNotifications(): Promise<Notification[]> {
  const response = await fetch('/api/notifications');
  if (!response.ok) {
    throw new Error('Failed to fetch notifications');
  }
  return response.json();
}

async function fetchUnreadCount(): Promise<number> {
  const response = await fetch('/api/notifications/unread-count');
  if (!response.ok) {
    throw new Error('Failed to fetch unread count');
  }
  return response.json();
}

/**
 * Inbox notifications hook (NotificationBell / NotificationDropdown).
 *
 * Uses React Query polling for eventual consistency.
 *
 * NOTE: Real-time SSE push is handled by the singleton `@/hooks/useNotifications`
 * (the system ticker). This hook intentionally does NOT open its own SSE connection
 * to avoid duplicate connections that trigger 429 (Too Many Requests) errors
 * against the per-user connection cap.
 */
export const useNotifications = () => {
  const queryClient = useQueryClient();
  const [isWindowFocused, setIsWindowFocused] = useState(true);

  // Track window focus to adjust polling frequency
  useEffect(() => {
    const handleFocus = () => setIsWindowFocused(true);
    const handleBlur = () => setIsWindowFocused(false);

    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  // 1. Main Notifications List Hook (Polling-based)
  const notificationsQuery = useQuery({
    queryKey: notificationKeys.list({}),
    queryFn: fetchNotifications,
    // Poll every 30s when focused, 0 when not focused
    refetchInterval: isWindowFocused ? 30000 : 0,
    refetchOnWindowFocus: true,
  });

  // 2. Unread Count Hook (Lightweight polling)
  const unreadCountQuery = useQuery({
    queryKey: notificationKeys.unreadCount(),
    queryFn: fetchUnreadCount,
    refetchInterval: isWindowFocused ? 30000 : 0,
    refetchOnWindowFocus: true,
  });

  // Invalidate caches to force refetch (for use after marking as read, etc.)
  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: notificationKeys.all });
  }, [queryClient]);

  return {
    notifications: notificationsQuery.data ?? [],
    isLoading: notificationsQuery.isLoading,
    isError: notificationsQuery.isError,
    unreadCount: unreadCountQuery.data ?? 0,
    isPolling: isWindowFocused,
    refresh,
  };
};
