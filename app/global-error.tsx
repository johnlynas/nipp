'use client';

/**
 * Next.js global error boundary for errors outside the component tree.
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <h1>Application Error</h1>
          <p>A critical error occurred. Please refresh the page.</p>
          <button onClick={() => reset()}>Refresh</button>
        </div>
      </body>
    </html>
  );
}
