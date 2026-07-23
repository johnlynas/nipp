export const orgKeys = {
  all: ['organization'] as const,
  details: () => [...orgKeys.all, 'details'] as const,
  settings: () => [...orgKeys.details(), 'settings'] as const,
  members: () => [...orgKeys.details(), 'members'] as const,
};
