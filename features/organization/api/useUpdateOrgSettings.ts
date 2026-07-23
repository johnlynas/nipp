import { useMutation, useQueryClient } from '@tanstack/react-query';
import { orgKeys } from './org.keys';

interface UpdateOrgSettingsPayload {
  name?: string;
  slug?: string;
}

async function updateOrgSettings(id: string, payload: UpdateOrgSettingsPayload): Promise<{ organization: any }> {
  const response = await fetch(`/api/admin/organizations/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to update organization settings');
  }

  return response.json();
}

export const useUpdateOrgSettings = (id: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: UpdateOrgSettingsPayload) => updateOrgSettings(id, payload),
    
    // Step 1: Optimistic Update
    onMutate: async (newSettings) => {
      // Cancel any outgoing refetches (so they don't overwrite our optimistic update)
      await queryClient.cancelQueries({ queryKey: orgKeys.details(id) });

      // Snapshot the previous value
      const previousSettings = queryClient.getQueryData(orgKeys.details(id));

      // Optimistically update to the new value
      queryClient.setQueryData(orgKeys.details(id), (old: any) => {
        if (!old) return old;
        return {
          ...old,
          ...newSettings,
        };
      });

      // Return context with the snapshotted value
      return { previousSettings };
    },

    // Step 2: Rollback on error
    onError: (err, newSettings, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(orgKeys.details(id), context.previousSettings);
      }
      console.error('Mutation error:', err);
    },

    // Step 3: Always refetch after error or success to ensure server sync
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: orgKeys.details(id) });
    },
  });
};
