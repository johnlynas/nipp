'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RequireSuperAdmin } from '@/components/auth/RequireSuperAdmin';

/**
 * Super Admin — Create new organization form.
 */
export default function CreateOrganizationPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [initialAdminEmail, setInitialAdminEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/admin/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, slug: slug || undefined, initialAdminEmail: initialAdminEmail || undefined }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create organization');
      }

      router.push('/admin/organizations');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <RequireSuperAdmin>
      <div className="min-h-screen">
        {/* Navy Header */}
        <header className="px-6 py-4" style={{ backgroundColor: '#1B2A4A' }}>
          <h1 className="text-xl font-semibold text-white">Property NI Admin</h1>
        </header>

        <main className="p-6">
          <h2 className="mb-6 text-2xl font-bold" style={{ color: '#1B2A4A' }}>Create Organization</h2>

          <form onSubmit={handleSubmit} className="max-w-md space-y-4">
            {error && (
              <div className="rounded bg-red-50 p-3 text-sm text-red-600" role="alert">{error}</div>
            )}

            <div>
              <label htmlFor="name" className="mb-1 block text-sm font-medium">Organization Name *</label>
              <input
                id="name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded border px-3 py-2"
              />
            </div>

            <div>
              <label htmlFor="slug" className="mb-1 block text-sm font-medium">Slug (optional, auto-generated)</label>
              <input
                id="slug"
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                className="w-full rounded border px-3 py-2"
                placeholder="e.g., acme-properties"
              />
            </div>

            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium">Initial Admin Email (optional)</label>
              <input
                id="email"
                type="email"
                value={initialAdminEmail}
                onChange={(e) => setInitialAdminEmail(e.target.value)}
                className="w-full rounded border px-3 py-2"
                placeholder="admin@example.com"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="rounded px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: '#F5A623' }}
            >
              {loading ? 'Creating...' : 'Create Organization'}
            </button>

            <a href="/admin/organizations" className="text-sm text-gray-500 hover:underline">
              Cancel
            </a>
          </form>
        </main>
      </div>
    </RequireSuperAdmin>
  );
}
