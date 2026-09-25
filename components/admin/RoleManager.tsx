'use client';

import { useState } from 'react';

interface Role {
  id: string;
  name: string;
  description?: string | null;
  isDefault: boolean;
}

interface RoleManagerProps {
  roles: Role[];
  canEdit?: boolean;
  canDelete?: boolean;
  onRoleCreated?: (role: Role) => void;
  onRoleUpdated?: (role: Role) => void;
  onRoleDeleted?: (roleId: string) => void;
}

/**
 * Reusable role CRUD component.
 */
export function RoleManager({ roles, canEdit = true, canDelete = true }: RoleManagerProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--color-navy-850)' }}>
          Roles
        </h2>
        {canEdit && (
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="rounded px-3 py-1.5 text-sm font-medium text-accent-ink transition"
            style={{ backgroundColor: 'var(--color-accent)' }}
            aria-label="Create new role"
          >
            {showCreateForm ? 'Cancel' : '+ Create Role'}
          </button>
        )}
      </div>

      {/* Roles Table */}
      <table className="min-w-full divide-y divide-slate-200" role="table">
        <thead className="bg-canvas-subtle border-b" style={{ borderColor: 'var(--color-slate-200)' }}>
          <tr>
            <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-slate-500" scope="col">
              Name
            </th>
            <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-slate-500" scope="col">
              Type
            </th>
            <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-slate-500" scope="col">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white">
          {roles.map((role) => (
            <tr key={role.id}>
              <td className="px-4 py-2 text-sm" style={{ color: 'var(--color-navy-850)' }}>
                {role.name}
              </td>
              <td className="px-4 py-2 text-sm text-slate-500">
                {role.isDefault ? 'Default' : 'Custom'}
              </td>
              <td className="px-4 py-2 text-right text-sm">
                {!role.isDefault && canDelete ? (
                  <button
                    className="text-danger-ink hover:text-danger"
                    aria-label={`Delete ${role.name}`}
                  >
                    Delete
                  </button>
                ) : role.isDefault ? (
                  <span className="text-slate-400" aria-label={`${role.name} is a default role, not editable`}>
                    Protected
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
