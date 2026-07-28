import { useQuery } from '@tanstack/react-query';
import { userKeys } from './user.keys';

interface UserProfile {
  id: string;
  email: string;
  name: string;
  image?: string;
  role: string;
}

interface UserSettings {
  theme: 'light' | 'dark' | 'system';
  notificationsEnabled: boolean;
  language: string;
}

async function fetchUserProfile(userId?: string): Promise<UserProfile> {
  // When no userId provided, resolve from the authenticated session cookie
  const url = userId ? `/api/user/${userId}/profile` : '/api/user/profile';
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch user profile');
  }
  return response.json();
}

async function fetchUserSettings(userId: string): Promise<UserSettings> {
  const response = await fetch(`/api/user/${userId}/settings`);
  if (!response.ok) {
    throw new Error('Failed to fetch user settings');
  }
  return response.json();
}

export const useUser = (userId?: string) => {
  return useQuery({
    queryKey: userKeys.profile(userId ?? 'current'),
    queryFn: () => fetchUserProfile(userId),
    staleTime: 1000 * 60 * 15, // 15 minutes (Identity is stable)
    gcTime: 1000 * 60 * 60,    // 1 hour
  });
};

export const useUserSettings = (userId: string) => {
  return useQuery({
    queryKey: userKeys.settings(userId),
    queryFn: () => fetchUserSettings(userId),
    staleTime: 1000 * 60 * 2,  // 2 minutes (Settings can change)
    gcTime: 1000 * 60 * 30,    // 30 minutes
  });
};