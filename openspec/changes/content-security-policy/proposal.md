# Content Security Policy Hardening

**Status:** Proposed  
**Author:** Property NI Development Team  
**Created:** 2026-07-15  
**Last Updated:** 2026-07-15  
**Related Issues:** Security hardening initiative

---

## Summary

This proposal outlines the hardening of the Content Security Policy (CSP) for the Property NI portal. The primary goal is to remove the `unsafe-inline` and `unsafe-eval` directives from the CSP headers and replace them with a cryptographically secure nonce-based approach. This will significantly reduce the attack surface for Cross-Site Scripting (XSS) and data injection attacks.

## Motivation

### Current State
The application currently relies on a permissive CSP that includes `unsafe-inline` and `unsafe-eval` to allow Next.js server components, BetterAuth scripts, and inline styles to function without strict configuration.

### Problems This Solves
1. **XSS Vulnerability:** `unsafe-inline` allows attackers to inject malicious scripts if they find an XSS vector.
2. **Code Execution:** `unsafe-eval` allows the execution of strings as code (e.g., `eval()`, `new Function()`), which is a major security risk.
3. **Code Review Recommendation:** The original architecture review identified CSP hardening as a critical security "Quick Win" for production readiness.

## Detailed Design

### Nonce-Based CSP Strategy
Instead of whitelisting all inline scripts/styles, we will generate a unique cryptographic nonce (number used once) for every HTTP request. This nonce will be injected into the CSP header and attached to all inline `<script>` and `<style>` tags.

### Proposed CSP Directives
The following strict CSP directives will be enforced via the `middleware.ts`:

```text
default-src 'self';
script-src 'self' 'nonce-{nonce}';
style-src 'self' 'nonce-{nonce}';
img-src 'self' data: blob:;
font-src 'self';
connect-src 'self';
frame-ancestors 'none';
base-uri 'self';
form-action 'self';

Implementation Approach
Nonce Generation: Create a utility function generateNonce() using the Web Crypto API (since middleware runs on Edge runtime).
Middleware Injection: Update middleware.ts to generate a nonce per request, attach it to the Content-Security-Policy header, and store it in the request headers.
Layout Integration: Update app/layout.tsx to read the nonce from the headers and apply it to inline styles/scripts.
Report-Only Mode: Initially deploy in Content-Security-Policy-Report-Only mode to monitor violations without breaking the application.
See design.md for complete technical details.
Files to Create or Modify
New Files
lib/csp-nonce.ts — Utility for generating and managing CSP nonces.
app/api/csp-report/route.ts — (Optional) Endpoint to receive CSP violation reports.
Modified Files
middleware.ts — Generate nonce and inject Content-Security-Policy header.
app/layout.tsx — Pass nonce to inline styles/scripts.
next.config.ts — Adjust security headers configuration.
Testing Plan
Report-Only Testing: Deploy with Content-Security-Policy-Report-Only and monitor the console/endpoint for violations.
Functional Testing: Verify that all pages (Login, Admin Dashboard, System Health, System Logs) load correctly without console errors.
Security Testing: Attempt to inject a simple <script>alert(1)</script> via a form input and verify it is blocked by the browser.
BetterAuth Integration: Verify that BetterAuth's session management and any inline styles it injects still function correctly with the nonce.
Risks & Mitigations
Risk
Impact
Mitigation
Breaking existing inline scripts
High
Use Report-Only mode first to identify all violations before enforcing.
BetterAuth incompatibility
Medium
Ensure BetterAuth's injected styles/scripts are compatible with nonce-based CSP.
Performance overhead of nonce generation
Low
Nonce generation via Web Crypto API is highly performant and negligible.
Implementation Timeline
Phase 1: Create nonce generation utility and update middleware.ts to inject headers in Report-Only mode.
Phase 2: Update app/layout.tsx and other components to use the nonce for inline styles/scripts.
Phase 3: Monitor violation reports and fix any broken functionality.
Phase 4: Switch CSP from Report-Only to enforcement mode.
Phase 5: Add CSP violation reporting endpoint for production monitoring.
See tasks.md for detailed implementation checklist.
Acceptance Criteria
unsafe-inline and unsafe-eval are completely removed from the CSP header.
A unique cryptographic nonce is generated for every request.
All inline scripts and styles use the generated nonce.
The application functions correctly with CSP in enforcement mode.
CSP violation reports are successfully captured (if reporting endpoint is implemented).
No regressions in BetterAuth session management or UI styling.
References
OWASP Content Security Policy Cheat Sheet
Next.js Security Headers Documentation
MDN: Content-Security-Policy

This proposal follows the OpenSpec format used by the Property NI project for tracking architectural changes and security improvements.
