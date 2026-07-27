import { useMutation, useQueryClient } from '@tanstack/react-query';
import { userKeys } from './user.keys';

interface UpdateUserProfilePayload {
  name?: string;
  image?: string;
}

async function updateUserProfile(userId: string, payload: UpdateUserProfilePayload): Promise<{ user: { id: string; name?: string; image?: string } }> {
  const response = await fetch(`/api/user/${userId}/profile`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to update user profile');
  }

  return response.json();
}

export const useUpdateUserProfile = (userId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: UpdateUserProfilePayload) => updateUserProfile(userId, payload),
    
    onMutate: async (newSettings) => {
      await queryClient.cancelQueries({ queryKey: userKeys.profile(userId) });

      const previousUser = queryClient.getQueryData(userKeys.profile(userId));

      queryClient.setQueryData(userKeys.profile(userId), (old: { id: string; name?: string; image?: string } | undefined) => {
        if (!old) return old;
        return {
          ...old,
          ...newSettings,
        };
      });

      return { previousUser };
    },

    onError: (err, newSettings, context) => {
      if (context?.previousUser) {
        queryClient.setQueryData(userKeys.profile(userId), context.previousUser);
      }
      console.error('Profile update error:', err);
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.profile(userId) });
    },
  });
};
