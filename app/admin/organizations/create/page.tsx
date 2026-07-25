'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function CreateOrganizationPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    name: '',
    adminEmail: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const response = await fetch('/api/admin/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to create organization');
      }
      
      // Success - redirect to organizations list
      router.push('/admin/organizations');
      router.refresh();
    } catch (error) {
      console.error('Failed to create organization:', error);
      alert(error instanceof Error ? error.message : 'Failed to create organization');
    }
  };

  return (
    <div className="flex-1 p-8">
      <div className="max-w-2xl mx-auto">
        {/* Form Card */}
        <div className="bg-white rounded-lg shadow-md border border-gray-200">
          <div className="p-8">
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Organization Name */}
              <div>
                <label htmlFor="name" className="block text-sm font-semibold text-gray-900 mb-2">
                  Organization Name
                  <span className="text-red-500 ml-1">*</span>
                </label>
                <input
                  type="text"
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  className="w-full px-4 py-3 border border-gray-300 rounded-md text-gray-900 font-medium text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  style={{ width: '100%', minWidth: '0' }}
                />
              </div>

              {/* Initial Admin Email */}
              <div>
                <label htmlFor="adminEmail" className="block text-sm font-semibold text-gray-900 mb-2">
                  Initial Admin Email
                  <span className="text-gray-500 font-normal ml-2">(optional)</span>
                </label>
                <input
                  type="email"
                  id="adminEmail"
                  value={formData.adminEmail}
                  onChange={(e) => setFormData({ ...formData, adminEmail: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-md text-gray-900 font-medium text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  style={{ width: '100%', minWidth: '0' }}
                />
              </div>

              {/* Action Buttons */}
              <div className="flex gap-4 pt-6 border-t border-gray-200">
                <button
                  type="submit"
                  className="flex-1 bg-[#F5A623] hover:bg-[#e0951f] text-white px-6 py-3 rounded-md font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[#F5A623] focus:ring-offset-2"
                >
                  Create Organization
                </button>
                <button
                  type="button"
                  onClick={() => router.back()}
                  className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 px-6 py-3 rounded-md font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
