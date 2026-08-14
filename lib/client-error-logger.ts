/**
 * Log a client-side error to the server via pino.
 * Uses `navigator.sendBeacon` when available for reliable delivery on page unload,
 * falls back to a regular fetch.
 */

export async function logClientError(message: string, page: string, action?: string): Promise<void> {
  const body = JSON.stringify({ message, page, action });

  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    navigator.sendBeacon('/api/dashboard/admin/errors', body);
  } else {
    try {
      await fetch('/api/dashboard/admin/errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      });
    } catch {
      // Silently fail — logging should never break the UI
    }
  }
}
