'use client';

import { useEffect } from 'react';

/**
 * Next.js error boundary for React component errors.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // TODO: Integrate with error tracking service (deferred to future proposal)
    console.error('Application error:', error);
  }, [error]);

  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h1>Something went wrong</h1>
      <p>We apologize for the inconvenience.</p>
      <button onClick={() => reset()}>Try again</button>
    </div>
  );
}
