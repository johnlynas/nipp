# Security: Content Security Policy Hardening

## Requirements

### Requirement 1: Nonce-Based CSP
The application MUST implement a nonce-based Content Security Policy that replaces `unsafe-inline` and `unsafe-eval` directives with cryptographically secure nonces.

#### Acceptance Criteria
- [ ] A unique cryptographic nonce is generated for every HTTP request using Web Crypto API
- [ ] The nonce is injected into the `Content-Security-Policy` header via middleware
- [ ] All inline `<script>` and `<style>` tags include the `nonce` attribute matching the header value
- [ ] `unsafe-inline` and `unsafe-eval` are completely removed from CSP directives

### Requirement 2: Strict CSP Directives
The application MUST enforce strict CSP directives that limit resource loading to the same origin.

#### Acceptance Criteria
- [ ] `default-src 'self'` is set as the fallback directive
- [ ] `script-src` allows only same-origin scripts and matching nonces
- [ ] `style-src` allows only same-origin stylesheets and matching nonces
- [ ] `img-src`, `font-src`, `connect-src` are restricted to same origin with appropriate exceptions
- [ ] `frame-ancestors 'none'` prevents clickjacking
- [ ] `base-uri 'self'` prevents base URL manipulation
- [ ] `form-action 'self'` restricts form submissions

### Requirement 3: Report-Only Mode Deployment
The application MUST initially deploy CSP in report-only mode to monitor violations before enforcement.

#### Acceptance Criteria
- [ ] Initial deployment uses `Content-Security-Policy-Report-Only` header
- [ ] CSP violations are logged to browser console and/or reporting endpoint
- [ ] Zero critical violations observed across all user flows before switching to enforcement mode

### Requirement 4: Integration Compatibility
The CSP implementation MUST maintain compatibility with existing application features.

#### Acceptance Criteria
- [ ] BetterAuth session management and authentication flows continue to work correctly
- [ ] All pages (Login, Admin Dashboard, System Health, System Logs) load without CSP errors
- [ ] Tailwind CSS styling and dynamic inline styles function correctly with nonce injection
