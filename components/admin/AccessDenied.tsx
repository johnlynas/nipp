'use client';

import Link from 'next/link';

/**
 * Fallback UI for unauthorized access attempts.
 */
export function AccessDenied() {
  return (
    <div className="flex min-h-[400px] items-center justify-center">
      <div className="text-center">
        <h1 className="mb-2 text-2xl font-bold" style={{ color: '#1B2A4A' }}>
          Access Denied
        </h1>
        <p className="mb-4 text-gray-600">
          You do not have permission to access this page.
        </p>
        <Link
          href="/"
          className="inline-block rounded px-4 py-2 text-sm font-medium text-white transition"
          style={{ backgroundColor: '#F5A623' }}
        >
          Go to Home
        </Link>
      </div>
    </div>
  );
}
