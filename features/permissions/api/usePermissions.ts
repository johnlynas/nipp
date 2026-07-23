import { useQuery } from '@tanstack/react-query';

export type PermissionKey = string; // e.g., 'logs:view' or 'users:manage'
export type RoleKey = string; // e.g., 'super_admin' or 'manager'

// Fetches the flattened list of permissions for the current user
async function fetchUserPermissions(): Promise<string[]> {
  const response = await fetch('/api/auth/user-permissions'); 
  if (!response.ok) {
    throw new Error('Failed to fetch permissions from the backend');
  }
  return response.json(); // Expected format: ['logs:view', 'users:manage']
}

export const usePermissions = () => {
  return useQuery({
    queryKey: ['user', 'role', 'permissions'],
    queryFn: fetchUserPermissions,
    // Permissions change rarely; we cache aggressively to avoid UI flickering
    staleTime: 1000 * 60 * 30, // "Fresh" for 30 minutes
    gcTime: 1000 * 60 * 60,    // Keep in cache for 1 hour
  });
};

// --- HOOKS FOR DIRECT LOGIC CHECKING ---

export const useHasPermission = (requiredPermissions: string[]) => {
  const { data, isLoading } = usePermissions();
  if (isLoading) return undefined; // "Unknown" state until cache loads

  const available = data ?? [];
  // User must have ALL the passed permissions (AND logic)
  return requiredPermissions.every((perm) => 
    available.includes(perm) || available.includes('*')
  );
};

export const useHasAnyPermission = (requiredPermissions: string[]) => {
  const { data, isLoading } = usePermissions();
  if (isLoading) return undefined; // "Unknown" state until cache loads

  const available = data ?? [];
  // User must have ONE of the passed permissions (OR logic)
  return requiredPermissions.some((perm) => 
    available.includes(perm) || available.includes('*')
  );
};

export const useUserRoles = () => {
  // Simulates fetching a list of roles
  return useQuery({
    queryKey: ['user', 'roles'],
    queryFn: async () => { 
      const response = await fetch('/api/auth/user-roles');
      return response.json(); // Expected format: [ 'manager', 'viewer' ]
    },
    staleTime: 1000 * 60 * 30, 
  });
};
