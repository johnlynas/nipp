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
        <h2 className="text-lg font-semibold" style={{ color: '#1B2A4A' }}>
          Roles
        </h2>
        {canEdit && (
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="rounded px-3 py-1.5 text-sm font-medium text-white transition"
            style={{ backgroundColor: '#F5A623' }}
            aria-label="Create new role"
          >
            {showCreateForm ? 'Cancel' : '+ Create Role'}
          </button>
        )}
      </div>

      {/* Roles Table */}
      <table className="min-w-full divide-y divide-gray-200" role="table">
        <thead className="bg-[#1B2A4A]">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">
              Name
            </th>
            <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">
              Type
            </th>
            <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-white" scope="col">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 bg-white">
          {roles.map((role) => (
            <tr key={role.id}>
              <td className="px-4 py-2 text-sm" style={{ color: '#1B2A4A' }}>
                {role.name}
              </td>
              <td className="px-4 py-2 text-sm text-gray-500">
                {role.isDefault ? 'Default' : 'Custom'}
              </td>
              <td className="px-4 py-2 text-right text-sm">
                {!role.isDefault && canDelete ? (
                  <button
                    className="text-red-600 hover:text-red-800"
                    aria-label={`Delete ${role.name}`}
                  >
                    Delete
                  </button>
                ) : role.isDefault ? (
                  <span className="text-gray-400" aria-label={`${role.name} is a default role, not editable`}>
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
