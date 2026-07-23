import { useMutation, useQueryClient } from '@tanstack/react-query';
import { userKeys } from './user.keys';

interface UpdateUserSettingsPayload {
  theme?: 'light' | 'dark' | 'system';
  notificationsEnabled?: boolean;
  language?: string;
}

async function updateUserSettings(userId: string, payload: UpdateUserSettingsPayload): Promise<{ settings: any }> {
  const response = await fetch(`/api/user/${userId}/settings`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to update user settings');
  }

  return response.json();
}

export const useUpdateUserSettings = (userId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: UpdateUserSettingsPayload) => updateUserSettings(userId, payload),
    
    onMutate: async (newSettings) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: userKeys.settings(userId) });

      // Snapshot the previous value
      const previousSettings = queryClient.getQueryData(userKeys.settings(userId));

      // Optimistically update the cache
      queryClient.setQueryData(userKeys.settings(userId), (old: any) => {
        if (!old) return old;
        return {
          ...old,
          ...newSettings,
        };
      });

      return { previousSettings };
    },

    onError: (err, newSettings, context) => {
      // Rollback on error
      if (context?.previousSettings) {
        queryClient.setQueryData(userKeys.settings(userId), context.previousSettings);
      }
      console.error('Settings update error:', err);
    },

    onSettled: () => {
      // Refetch to ensure sync
      queryClient.invalidateQueries({ queryKey: userKeys.settings(userId) });
    },
  });
};
