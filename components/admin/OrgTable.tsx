'use client';

import Link from 'next/link';
import { Eye, Pencil, Trash2 } from 'lucide-react';
import { OrgStatusBadge } from './OrgStatusBadge';

interface Organization {
  id: string;
  name: string;
  slug: string | null;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  memberCount: number;
  createdAt: string | Date;
}

interface OrgTableProps {
  organizations: Organization[];
}

/**
 * Organization table with Link-based navigation for view/edit and optional delete callback.
 */
export function OrgTable({ organizations }: OrgTableProps) {
  const formatDate = (date: string | Date) => {
    return new Date(date).toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200" role="table">
        <thead className="bg-[#1B2A4A]">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">
              Organization Name
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">
              Status
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">
              Members
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">
              Created Date
            </th>
            <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-white" scope="col">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 bg-white">
          {organizations.map((org) => (
            <tr key={org.id} className="hover:bg-gray-50">
              <td className="whitespace-nowrap px-6 py-4 text-sm font-medium" style={{ color: '#1B2A4A' }}>
                {org.name}
              </td>
              <td className="whitespace-nowrap px-6 py-4">
                <OrgStatusBadge status={org.status} />
              </td>
              <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                {org.memberCount}
              </td>
              <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                {formatDate(org.createdAt)}
              </td>
              <td className="whitespace-nowrap px-6 py-4 text-right">
                <div className="flex justify-end gap-2">
                  <Link href={`/admin/organizations/${org.id}`} className="text-blue-600 hover:text-blue-800 transition-colors" title="View" aria-label={`View ${org.name}`}>
                    <Eye className="w-4 h-4" />
                  </Link>
                  <Link href={`/admin/organizations/${org.id}/edit`} className="text-amber-600 hover:text-amber-800 transition-colors" title="Edit" aria-label={`Edit ${org.name}`}>
                    <Pencil className="w-4 h-4" />
                  </Link>
                  <Link href={`/admin/organizations/${org.id}/delete`} className="text-red-600 hover:text-red-800 transition-colors" title="Delete" aria-label={`Delete ${org.name}`}>
                    <Trash2 className="w-4 h-4" />
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
