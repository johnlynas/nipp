/**
 * Client-side session-expired guard for plain `fetch()` API calls.
 *
 * The root middleware (middleware.ts) 307-redirects any request without a valid
 * session cookie to /login. `fetch()` follows that redirect transparently, so an
 * expired session surfaces as an HTML login page with status 200 — and the next
 * `res.json()` throws `SyntaxError: Unexpected token '<'` (repo-confirmed).
 *
 * Call this after every `fetch()` to `/api/*` (including via encryptedFetch,
 * which passes non-PII routes straight through to fetch): if the response is not
 * JSON, the session has expired — bounce to /login before showing any error.
 */
export function guardSessionExpired(res: Response): void {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return;
  // HTML response from an API call (redirect target served 200) — expired session.
  // Skip true binary endpoints (images etc.) which legitimately aren't JSON.
  if (contentType.startsWith('text/html')) {
    redirectToLogin();
  }
}

function redirectToLogin(): void {
  if (typeof window === 'undefined') return;
  const current = encodeURIComponent(window.location.pathname);
  window.location.href = `/login?callbackUrl=${current}`;
}
