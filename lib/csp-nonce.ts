/**
 * CSP Nonce Generator Utility
 * 
 * Generates cryptographically secure random nonces for Content Security Policy.
 * Uses the Web Crypto API to ensure compatibility with Next.js Edge Runtime (middleware).
 */

export function generateNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
