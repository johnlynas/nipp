import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
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

  // --- SSE BRIDGE: Real-time Injection ---
  useEffect(() => {
    // Only connect if window is focused to prevent stale/useless connections in background
    if (!isWindowFocused) return;

    const eventSource = new EventSource('/api/notifications/stream');

    eventSource.onmessage = (event) => {
      try {
        const newNotification: Notification = JSON.parse(event.data);

        // 1. Inject into the Notifications List cache
        queryClient.setQueryData(notificationKeys.list({}), (old: Notification[] | undefined) => {
          if (!old) return [newNotification];
          // Prepend the new notification to the top of the list
          return [newNotification, ...old];
        });

        // 2. Increment the Unread Count cache (Optimistic update for the count)
        queryClient.setQueryData(notificationKeys.unreadCount(), (old: number | undefined) => {
          return (old ?? 0) + 1;
        });

      } catch (error) {
        console.error('Failed to parse SSE notification:', error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('SSE connection error:', error);
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [isWindowFocused, queryClient]);

  // 1. Main Notifications List Hook (Uses Polling as fallback/sync)
  const notificationsQuery = useQuery({
    queryKey: notificationKeys.list({}),
    queryFn: fetchNotifications,
    // We keep polling at a very slow rate now (e.g., 60s) because SSE handles the 'push'
    // This acts as a safety net to ensure eventual consistency if a socket event was missed.
    refetchInterval: isWindowFocused ? 60000 : 0,
    refetchOnWindowFocus: true, 
  });

  // 2. Unread Count Hook (Lightweight)
  const unreadCountQuery = useQuery({
    queryKey: notificationKeys.unreadCount(),
    queryFn: fetchUnreadCount,
    refetchInterval: isWindowFocused ? 60000 : 0,
    refetchOnWindowFocus: true,
  });

  return {
    notifications: notificationsQuery.data ?? [],
    isLoading: notificationsQuery.isLoading,
    isError: notificationsQuery.isError,
    unreadCount: unreadCountQuery.data ?? 0,
    isPolling: isWindowFocused,
  };
};
