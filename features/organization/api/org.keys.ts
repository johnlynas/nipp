export const orgKeys = {
  all: ['organization'] as const,
  details: (id: string) => [...orgKeys.all, 'details', id] as const,
  settings: (id: string) => [...orgKeys.details(id), 'settings'] as const,
  members: (id: string) => [...orgKeys.details(id), 'members'] as const,
};
