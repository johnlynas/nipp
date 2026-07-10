'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { RoleManager } from '@/components/admin/RoleManager';

interface Role {
  id: string;
  name: string;
  description?: string | null;
  isDefault: boolean;
}

/**
 * Org Admin — Role management scoped to their organization.
 * Default roles are read-only; custom roles have full CRUD.
 */
export default function OrgRolesPage() {
  const params = useParams();
  const orgId = params.orgId as string;

  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRoles();
  }, [orgId]);

  async function fetchRoles() {
    setLoading(true);
    try {
      const res = await fetch(`/api/roles?organizationId=${orgId}`);
      if (res.ok) {
        const data = await res.json();
        setRoles(data.roles || []);
      }
    } catch (error) {
      console.error('Failed to fetch roles:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="p-6">Loading roles...</div>;

  // Separate default and custom roles
  const defaultRoles = roles.filter((r) => r.isDefault);
  const customRoles = roles.filter((r) => !r.isDefault);

  return (
    <div className="min-h-screen p-6">
      <h1 className="mb-6 text-2xl font-bold" style={{ color: '#1B2A4A' }}>
        Role Management
      </h1>

      {/* Default Roles — Read Only */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold" style={{ color: '#1B2A4A' }}>
          Default Roles (Read-Only)
        </h2>
        <RoleManager roles={defaultRoles} canEdit={false} canDelete={false} />
      </section>

      {/* Custom Roles — Full CRUD */}
      <section>
        <h2 className="mb-3 text-lg font-semibold" style={{ color: '#1B2A4A' }}>
          Custom Roles
        </h2>
        <RoleManager roles={customRoles} canEdit={true} canDelete={true} />
      </section>
    </div>
  );
}
