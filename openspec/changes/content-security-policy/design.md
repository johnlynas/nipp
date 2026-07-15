# Design: Content Security Policy Hardening

## Architecture Overview
This design outlines a nonce-based Content Security Policy (CSP) implementation for the Next.js 15 App Router. The core challenge is generating a unique nonce per request in the Edge-runtime `middleware.ts` and passing it to the Node-runtime React Server Components (RSC) to be applied to inline scripts and styles.

## Data Flow
1. **Request Ingress:** HTTP request hits `middleware.ts` (Edge Runtime).
2. **Nonce Generation:** Middleware generates a cryptographically secure random nonce using the Web Crypto API (`crypto.getRandomValues`).
3. **Header Injection:** Middleware sets the `Content-Security-Policy` (initially in Report-Only mode) and a custom `x-csp-nonce` header on the incoming request.
4. **RSC Consumption:** `app/layout.tsx` reads the `x-csp-nonce` header using the `headers()` API.
5. **DOM Injection:** The nonce is applied to the `<meta>` CSP tag and any custom inline `<script>` or `<style>` elements.

## Technical Decisions

### 1. Nonce Generation in Edge Runtime
Next.js middleware runs on the Edge runtime, which does not support Node's `crypto.randomBytes`. We must use the Web Crypto API.

```typescript
// lib/csp-nonce.ts
export function generateNonce() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

2. Middleware Header Propagation
To pass the nonce from the Edge middleware to the App Router, we append it to the request headers. Next.js allows mutating request headers in middleware.

// middleware.ts
const nonce = generateNonce();
request.headers.set('x-csp-nonce', nonce);

3. Handling Next.js Built-in Scripts
Next.js automatically injects scripts for hydration and routing. In Next.js 13+, many of these are automatically nonce-aware if configured correctly, but custom scripts using next/script must explicitly receive the nonce prop.
4. Report-Only vs Enforcement
We will initially deploy with Content-Security-Policy-Report-Only. This allows the browser to log violations to the console (and a reporting endpoint) without blocking resources, preventing immediate breakage of the UI.
CSP Directive Breakdown
default-src 'self'
Only allow resources from the same origin by default. This is the fallback for other directives.
script-src 'self' 'nonce-{nonce}'
'self': Allow scripts from the same origin.
'nonce-{nonce}': Allow inline scripts that have the matching nonce attribute.
Removed: 'unsafe-inline', 'unsafe-eval'
style-src 'self' 'nonce-{nonce}'
'self': Allow stylesheets from the same origin.
'nonce-{nonce}': Allow inline styles that have the matching nonce attribute.
Removed: 'unsafe-inline'
img-src 'self' data: blob:
'self': Allow images from the same origin.
data:: Allow data URIs (needed for base64 images).
blob:: Allow blob URLs (needed for certain features).
font-src 'self'
Only allow fonts from the same origin.
connect-src 'self'
Only allow XHR/fetch/WebSocket connections to the same origin.
frame-ancestors 'none'
Prevent the page from being embedded in an iframe (clickjacking protection).
base-uri 'self'
Prevent attackers from changing the base URL to load malicious scripts from external domains.
form-action 'self'
Only allow form submissions to the same origin.
Security Considerations
Nonce Secrecy: The nonce must be unique per request. If an attacker can predict or reuse a nonce, the CSP is bypassed.
Base URI: base-uri 'self' is critical to prevent attackers from changing the base URL to load malicious scripts from external domains.
Frame Ancestors: frame-ancestors 'none' prevents clickjacking attacks.
Reporting: Implement a CSP violation reporting endpoint to monitor attacks in production.
