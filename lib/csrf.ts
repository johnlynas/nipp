/**
 * CSRF protection for API routes.
 *
 * Validates that state-changing requests (POST/PUT/PATCH/DELETE) originate from
 * the same site by checking the Origin and Referer headers against the expected
 * frontend URL.
 *
 * This provides defense-in-depth alongside:
 * - SameSite=Lax cookies (browser-enforced CSRF protection)
 * - CSP form-action 'self' directive
 * - HTTP-only session cookies (not sent with cross-site requests by default)
 */

import { env } from '@/lib/env';

/**
 * Expected origin for same-site requests.
 * Uses FRONTEND_URL env var, falling back to a development default.
 */
function getExpectedOrigin(): string {
  const url = env.FRONTEND_URL;
  // Extract origin (protocol + host + port) from full URL
  try {
    return new URL(url).origin;
  } catch {
    // Fallback if FRONTEND_URL is malformed
    return 'http://localhost:3000';
  }
}

/**
 * Validate that a state-changing request originates from the same site.
 *
 * Returns true if:
 * - The request method is safe (GET, HEAD, OPTIONS) — no validation needed
 * - The Origin header matches the expected frontend origin
 * - The Referer header's origin matches the expected frontend origin
 * - We're in development mode (relaxed validation)
 *
 * Returns false if the request appears to be a cross-site request.
 */
export function isSameSiteRequest(
  method: string,
  headers: Headers
): boolean {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(method.toUpperCase())) return true;

  const expectedOrigin = getExpectedOrigin();
  const origin = headers.get('origin');
  const referer = headers.get('referer');

  // Origin header is the primary CSRF indicator
  if (origin && origin === expectedOrigin) return true;

  // Referer is a fallback — extract its origin
  if (referer) {
    try {
      const refererOrigin = new URL(referer).origin;
      if (refererOrigin === expectedOrigin) return true;
    } catch {
      // Malformed Referer — ignore it
    }
  }

  // In development, relax validation to allow tools like Postman/curl
  if (env.NODE_ENV !== 'production') return true;

  return false;
}
