'use client';

import { createContext, useContext, useState, useCallback } from 'react';

/**
 * Organization context provider — scaffolding only.
 *
 * Stores the current organization in React context and provides
 * organization data to child components. Handles organization switching.
 */

interface Organization {
  id: string;
  name: string;
  slug?: string | null;
}

interface OrganizationContextType {
  currentOrg: Organization | null;
  organizations: Organization[];
  setCurrentOrg: (org: Organization) => void;
}

const OrganizationContext = createContext<OrganizationContextType | null>(null);

export function OrganizationProvider({ children }: { children: React.ReactNode }) {
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);

  const handleSetCurrentOrg = useCallback((org: Organization) => {
    setCurrentOrg(org);
    // TODO: Update AsyncLocalStorage tenant context and session cookie
  }, []);

  return (
    <OrganizationContext.Provider
      value={{ currentOrg, organizations, setCurrentOrg: handleSetCurrentOrg }}
    >
      {children}
    </OrganizationContext.Provider>
  );
}

export function useOrganization() {
  const context = useContext(OrganizationContext);
  if (!context) {
    throw new Error('useOrganization must be used within an OrganizationProvider');
  }
  return context;
}
