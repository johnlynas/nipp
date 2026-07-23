export const userKeys = {
  all: (userId: string) => ['user', userId] as const,
  profile: (userId: string) => [...userKeys.all(userId), 'profile'] as const,
  settings: (userId: string) => [...userKeys.all(userId), 'settings'] as const,
};
