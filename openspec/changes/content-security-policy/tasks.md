# Tasks: Content Security Policy Hardening

## Phase 1: Foundation & Report-Only Mode
- [ ] **Task 1.1:** Create `lib/csp-nonce.ts` with the `generateNonce()` function using Web Crypto API.
- [ ] **Task 1.2:** Update `middleware.ts` to import the nonce generator.
- [ ] **Task 1.3:** In `middleware.ts`, generate a nonce for every request and set it on `request.headers` as `x-csp-nonce`.
- [ ] **Task 1.4:** In `middleware.ts`, construct the CSP header string. **Crucial:** Use `Content-Security-Policy-Report-Only` for the header name initially.
- [ ] **Task 1.5:** Add the nonce to the `script-src` and `style-src` directives (e.g., `'nonce-${nonce}'`).
- [ ] **Task 1.6:** Remove `'unsafe-inline'` and `'unsafe-eval'` from the CSP string.

## Phase 2: React Integration
- [ ] **Task 2.1:** Update `app/layout.tsx` to import `headers` from `next/headers`.
- [ ] **Task 2.2:** In `layout.tsx`, read the `x-csp-nonce` header.
- [ ] **Task 2.3:** Pass the nonce to the `<meta httpEquiv="Content-Security-Policy" ... />` tag in the `<head>` if applicable, or ensure the middleware header is sufficient.
- [ ] **Task 2.4:** Audit all custom `<script>` tags in the codebase. Replace standard `<script>` with `next/script` and pass the `nonce` prop.

## Phase 3: Testing & Violation Resolution
- [ ] **Task 3.1:** Run the app locally and open the browser console. Filter for "Content Security Policy".
- [ ] **Task 3.2:** Navigate through all pages (Login, Admin Dashboard, System Health, System Logs).
- [ ] **Task 3.3:** Fix any UI breakage caused by blocked scripts/styles (e.g., BetterAuth UI, Tailwind inline styles). *Note: Tailwind's JIT compiler usually outputs static CSS files, which are covered by `style-src 'self'`, but dynamic inline styles may need the nonce.*
- [ ] **Task 3.4:** Verify BetterAuth session cookies and redirects still function.

## Phase 4: Enforcement & Cleanup
- [ ] **Task 4.1:** Once zero violations are observed in the console across all user flows, change the header name in `middleware.ts` from `Content-Security-Policy-Report-Only` to `Content-Security-Policy`.
- [ ] **Task 4.2:** (Optional) Create `app/api/csp-report/route.ts` to accept POST requests for CSP violations for production monitoring.
- [ ] **Task 4.3:** Add `report-uri /api/csp-report` to the CSP header string.
- [ ] **Task 4.4:** Test CSP violation reporting by intentionally triggering a violation.

## Phase 5: Production Deployment
- [ ] **Task 5.1:** Deploy to staging environment with CSP in enforcement mode.
- [ ] **Task 5.2:** Monitor CSP violation reports for 1 week.
- [ ] **Task 5.3:** Deploy to production with CSP in enforcement mode.
- [ ] **Task 5.4:** Set up alerts for CSP violation spikes in production.
