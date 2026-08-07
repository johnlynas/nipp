'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { encryptedFetch } from '@/lib/api-client';
import { useIsSuperAdmin } from '@/hooks/usePermission';

interface Organization {
  id: string;
  name: string;
  slug: string;
}

export default function CreateRolePage() {
  const router = useRouter();
  const isSuperAdmin = useIsSuperAdmin();

  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formIsDefault, setFormIsDefault] = useState(false);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [filteredOrgs, setFilteredOrgs] = useState<Organization[]>([]);
  const [loadingOrgs, setLoadingOrgs] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  // Ref for detecting clicks outside the dropdown
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch organizations for platform admins — runs on mount AND when isSuperAdmin changes
  useEffect(() => {
    if (isSuperAdmin === true) {
      fetchOrganizations();
    }
  }, [isSuperAdmin]);

  // Also fetch on mount in case isSuperAdmin is already true (cached session)
  useEffect(() => {
    if (isSuperAdmin === true && organizations.length === 0) {
      fetchOrganizations();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Filter organizations based on search query
  useEffect(() => {
    if (searchQuery.trim() === '') {
      setFilteredOrgs(organizations);
    } else {
      const query = searchQuery.toLowerCase();
      setFilteredOrgs(
        organizations.filter((org) => org.name.toLowerCase().includes(query))
      );
    }
  }, [searchQuery, organizations]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function fetchOrganizations() {
    setLoadingOrgs(true);
    try {
      // Fetch all organizations (high pageSize to avoid pagination)
      const res = await encryptedFetch('/api/admin/organizations?page=1&pageSize=500', { pii: true });
      if (res.ok) {
        const data = await res.json();
        const orgs = data.organizations || [];
        setOrganizations(orgs);
        setFilteredOrgs(orgs);
      } else {
        const errorData = await res.json().catch(() => ({}));
        console.error('[CreateRole] Failed to fetch organizations:', res.status, errorData);
      }
    } catch (err) {
      console.error('[CreateRole] Exception fetching organizations:', err);
    } finally {
      setLoadingOrgs(false);
    }
  }

  function handleSelectOrganization(org: Organization) {
    setSelectedOrgId(org.id);
    setSearchQuery(org.name);
    setShowDropdown(false);
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const body: Record<string, unknown> = { name: formName, description: formDescription || undefined, isDefault: formIsDefault };

      // Platform admins must select an org; tenant admins don't see this field
      if (isSuperAdmin === true && selectedOrgId) {
        body.organizationId = selectedOrgId;
      }

      const res = await encryptedFetch('/api/admin/roles', {
        method: 'POST',
        body: JSON.stringify(body),
        pii: true,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create role');
      }

      router.push('/admin/roles');
      router.refresh();
    } catch (err) {
      console.error('Failed to create role:', err);
      setError(err instanceof Error ? err.message : 'Failed to create role');
    } finally {
      setSubmitting(false);
    }
  };

  // Show loading state while checking super admin status
  if (isSuperAdmin === null) {
    return (
      <div className="flex-1 p-8">
        <p className="py-8 text-center">Loading...</p>
      </div>
    );
  }

  const showOrgSelector = isSuperAdmin === true;

  return (
    <div className="flex-1 p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center gap-4">
          <Link href="/admin/roles" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
            ← Back to Roles
          </Link>
        </div>

        {/* Form Card */}
        <div className="bg-white rounded-lg shadow-md border border-gray-200">
          <form onSubmit={handleSubmit} className="p-8 space-y-6">
            <div>
              <h1 className="text-xl font-bold" style={{ color: '#1B2A4A' }}>New Role</h1>
              <p className="text-sm text-gray-500 mt-1">Create a new role</p>
            </div>

            {error && (
              <div className="rounded border bg-red-50 p-3 text-sm text-red-700" role="alert">
                {error}
              </div>
            )}

            {/* Organization Selector (platform admins only) */}
            {showOrgSelector && (
              <div ref={dropdownRef}>
                <label htmlFor="organizationId" className="block text-sm font-semibold text-gray-900 mb-2">
                  Organization <span className="text-red-500">*</span>
                </label>
                {loadingOrgs ? (
                  <p className="text-sm text-gray-500">Loading organizations...</p>
                ) : (
                  <div className="relative">
                    {/* Search Input */}
                    <input
                      type="text"
                      id="organizationId"
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setShowDropdown(true);
                        // Clear selection when typing
                        if (selectedOrgId) {
                          setSelectedOrgId('');
                        }
                      }}
                      onFocus={() => setShowDropdown(true)}
                      placeholder="Type to search organizations..."
                      required
                      className="w-full px-4 py-3 border border-gray-300 rounded-md text-gray-900 font-medium text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />

                    {/* Dropdown */}
                    {showDropdown && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                        {filteredOrgs.length === 0 ? (
                          <div className="px-4 py-3 text-sm text-gray-500">
                            No organizations found
                          </div>
                        ) : (
                          filteredOrgs.map((org) => (
                            <button
                              key={org.id}
                              type="button"
                              onClick={() => handleSelectOrganization(org)}
                              className={`w-full px-4 py-3 text-left text-sm hover:bg-gray-100 transition-colors ${
                                selectedOrgId === org.id ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-900'
                              }`}
                            >
                              <div className="font-medium">{org.name}</div>
                              <div className="text-xs text-gray-500 mt-0.5">{org.slug}</div>
                            </button>
                          ))
                        )}
                      </div>
                    )}

                    {/* Selected org indicator */}
                    {selectedOrgId && (
                      <div className="mt-2 text-xs text-green-600 font-medium">
                        ✓ {searchQuery} selected
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Role Name */}
            <div>
              <label htmlFor="name" className="block text-sm font-semibold text-gray-900 mb-2">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                required
                placeholder="e.g. Manager"
                className="w-full px-4 py-3 border border-gray-300 rounded-md text-gray-900 font-medium text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Description */}
            <div>
              <label htmlFor="description" className="block text-sm font-semibold text-gray-900 mb-2">
                Description <span className="text-gray-500 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                id="description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Describe the role"
                className="w-full px-4 py-3 border border-gray-300 rounded-md text-gray-900 font-medium text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Default Role */}
            <div>
              <label className="flex items-center gap-3 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={formIsDefault}
                  onChange={(e) => setFormIsDefault(e.target.checked)}
                  className="rounded border-gray-300 w-4 h-4"
                />
                Default role (automatically assigned to new users)
              </label>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-4">
              <Link href="/admin/roles" className="rounded px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100 border border-gray-300">
                Cancel
              </Link>
              <button
                type="submit"
                disabled={submitting}
                className="rounded px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#F5A623' }}
              >
                {submitting ? 'Creating...' : 'Create Role'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
