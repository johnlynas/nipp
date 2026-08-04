import { useQuery } from '@tanstack/react-query';
import { orgKeys } from './org.keys';
import { encryptedFetch } from '@/lib/api-client';

interface Organization {
  id: string;
  name: string;
  slug: string;
  status: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

async function fetchOrgDetails(id: string): Promise<Organization> {
  const response = await encryptedFetch(`/api/admin/organizations/${id}`, { pii: true });
  if (!response.ok) {
    throw new Error('Failed to fetch organization details');
  }
  return response.json();
}

export const useOrganization = (id: string) => {
  return useQuery({
    queryKey: orgKeys.details(id),
    queryFn: () => fetchOrgDetails(id),
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 30,   // 30 minutes
  });
};
