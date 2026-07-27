export const notificationKeys = {
  all: ['notifications'] as const,
  list: (filters?: Record<string, unknown>) => [...notificationKeys.all, 'list', filters] as const,
  unreadCount: () => [...notificationKeys.all, 'unread-count'] as const,
};
