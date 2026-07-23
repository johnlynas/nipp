'use client';

import React, { useState } from 'react';
import { useOrganization } from '../api/useOrganization';
import { useUpdateOrgSettings } from '../api/useUpdateOrgSettings';

interface OrganizationSettingsFormProps {
  orgId: string;
}

export const OrganizationSettingsForm = ({ orgId }: OrganizationSettingsFormProps) => {
  const { data: organization, isLoading, isError } = useOrganization(orgId);
  const { mutate: updateSettings, isPending: isUpdating } = useUpdateOrgSettings(orgId);

  const [formData, setFormData] = useState({
    name: '',
    slug: '',
  });

  // Sync local form state when data is loaded
  React.useEffect(() => {
    if (organization) {
      setFormData({
        name: organization.name,
        slug: organization.slug,
      });
    }
  }, [organization]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings(formData);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  if (isLoading) return <div className="p-4 text-gray-500">Loading organization data...</div>;
  if (isError) return <div className="p-4 text-red-500">Error loading organization settings.</div>;
  if (!organization) return <div className="p-4 text-gray-500">No organization found.</div>;

  return (
    <div className="max-w-lg p-6 bg-white rounded-lg shadow-md border border-gray-200">
      <h2 className="text-xl font-semibold mb-6 text-gray-800">Organization Settings</h2>
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
            Organization Name
          </label>
          <input
            type="text"
            id="name"
            name="name"
            value={formData.name}
            onChange={handleChange}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
            required
          />
        </div>

        <div>
          <label htmlFor="slug" className="block text-sm font-medium text-gray-700 mb-1">
            URL Slug
          </label>
          <input
            type="text"
            id="slug"
            name="slug"
            value={formData.slug}
            onChange={handleChange}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
            required
          />
        </div>

        <div className="pt-4">
          <button
            type="submit"
            disabled={isUpdating}
            className={`w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white 
              ${isUpdating ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500'}`}
          >
            {isUpdating ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>

      <div className="mt-4 text-xs text-gray-400 italic">
        Last updated: {organization.updatedAt}
      </div>
    </div>
  );
};
