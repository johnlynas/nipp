

# Fix: Super Admin Auth Bypass via Email Fallback

**Status:** Proposed  
**Author:** Property NI Development Team  
**Created:** 2026-07-15  
**Last Updated:** 2026-07-17  
**Related Issues:** Critical Issue #2 — Email-based super admin fallback is an auth bypass

---

## Summary

This proposal addresses a critical security vulnerability where multiple admin API routes fall back to an email-based authorization check when the database is unavailable. This "fail-open" behavior allows anyone with a valid session for the configured `SUPER_ADMIN_EMAIL` to bypass all database-backed authorization checks, effectively granting unrestricted super-admin access during outages or errors. 

Additionally, this proposal mandates the **exclusive use of the `pino` logging framework** for all logging within the affected code paths, replacing any `console.log` or `console.error` statements to ensure structured, high-performance, and observable logging.

## Motivation

### Current State
Several admin API routes (`/api/admin/organizations`, `/api/admin/organizations/[id]`, `/api/admin/organizations/[id]/status`) contain `try/catch` blocks around the super-admin verification logic. If the database check throws an error, the code silently falls back to:

```typescript
const knownSuperAdminEmail = process.env.SUPER_ADMIN_EMAIL || 'admin@nipp.gov.uk';
isSuperAdmin = userEmail === knownSuperAdminEmail;
```

### Problems This Solves
1. **Silent Authorization Bypass:** Any request with a valid session cookie for the fallback email bypasses all DB-based authorization, regardless of actual user permissions.
2. **Fail-Open Security Model:** The system grants elevated privileges during errors instead of failing securely (fail-closed), violating security best practices.
3. **Lack of Visibility:** The fallback is not logged at an appropriate severity level, making it difficult to detect unauthorized access attempts or system outages.
4. **Hardcoded Default:** The fallback defaults to `admin@nipp.gov.uk` if `SUPER_ADMIN_EMAIL` is unset, creating a predictable attack vector.
5. **Unstructured Logging:** Reliance on `console.log` or ad-hoc logging prevents effective log aggregation, filtering, and automated alerting in production environments.

## Detailed Design

### Remove Email Fallback Entirely
The database must be the authoritative source for authorization decisions. If the database is unavailable, access should be denied with a clear error response and an error-level log entry.

### Centralize Authorization Logic
Extract the super-admin check into a dedicated utility function that:
- Always queries the database for membership verification.
- Logs errors at the `error` level **exclusively using the `pino` logging framework** (no `console.log`, `console.error`, or other logging mechanisms).
- Utilizes `pino` child loggers to automatically attach relevant request context (e.g., `userId`, `orgId`, `reqId`) to every log entry for traceability.
- Returns a consistent error response (`401 Unauthorized` or `503 Service Unavailable`) when the database is unreachable.

### Update Affected Routes
Replace all `try/catch` fallback patterns and any existing `console.*` logging statements in:
- `app/api/admin/organizations/route.ts` (GET and POST handlers)
- `app/api/admin/organizations/[id]/route.ts` (`checkSuperAdmin` helper)
- `app/api/admin/organizations/[id]/status/route.ts` (`checkSuperAdmin` helper)

See [design.md](./design.md) for complete technical details.

## Files to Create or Modify

### Modified Files
- `lib/logger.ts` — Ensure the centralized `pino` logger instance is configured correctly (using direct streams to avoid Next.js worker thread bundling issues).
- `app/api/admin/organizations/route.ts` — Remove email fallback from GET and POST handlers; replace any `console` logging with `pino`.
- `app/api/admin/organizations/[id]/route.ts` — Remove email fallback from `checkSuperAdmin` helper; replace any `console` logging with `pino`.
- `app/api/admin/organizations/[id]/status/route.ts` — Remove email fallback from `checkSuperAdmin` helper; replace any `console` logging with `pino`.
- `lib/authz.ts` (optional/new) — Add a centralized `verifySuperAdmin()` function that enforces the `pino` logging standard and fail-closed behavior.

## Testing Plan

1. **Happy Path:** Verify super-admin access works when the database is healthy and the user has proper membership.
2. **Database Unavailable:** Simulate DB outage (e.g., stop PostgreSQL) and verify:
   - Requests return `503 Service Unavailable` or `401 Unauthorized` (not 200 OK).
   - An error is logged at the `error` level via `pino` with clear context (e.g., JSON output containing `userId`, `orgId`, and error details).
   - No fallback to email-based access occurs.
3. **Invalid Session:** Verify non-admin users are still rejected with `401/403`.
4. **Missing SUPER_ADMIN_EMAIL:** Verify the system does not default to `admin@nipp.gov.uk`.
5. **Logging Verification:** Inspect development and production logs to confirm zero `console.log` output from these routes and valid structured JSON output from `pino` in production mode.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Admin routes fail during DB maintenance | Medium | Implement graceful degradation with clear error messages; ensure monitoring alerts on 503 responses. |
| Existing deployments rely on fallback behavior | Low | Document breaking change; communicate to ops team before deployment. |
| Increased error logging volume | Low | Log only on actual authorization failures or DB unavailability, not on every request. `pino`'s high performance ensures this will not impact throughput. |

## Implementation Timeline

1. **Phase 1:** Extract super-admin verification into a centralized utility function.
2. **Phase 2:** Update all affected admin API routes to use the new utility, remove fallback logic, and replace all `console.*` statements with the `pino` logger.
3. **Phase 3:** Implement `pino` child loggers to ensure request context (`userId`, `orgId`) is automatically attached to authorization failure logs.
4. **Phase 4:** Test database outage scenarios and verify fail-closed behavior and structured log output.

See [tasks.md](./tasks.md) for detailed implementation checklist.

## Acceptance Criteria

- [ ] All `try/catch` email fallback patterns removed from admin API routes.
- [ ] Authorization failures log at the `error` level with clear context.
- [ ] Database unavailability returns an appropriate error response (401/503), not 200 OK.
- [ ] No hardcoded default email (`admin@nipp.gov.uk`) exists in authorization logic.
- [ ] **All logging in the modified routes and utilities uses the `pino` framework exclusively** (no `console.log`, `console.error`, or other logging mechanisms remain).
- [ ] Tests verify fail-closed behavior during simulated DB outage.
- [ ] Logs produced during failure states are verified to be structured JSON (in production) or properly formatted via `pino-pretty` (in development), containing relevant request context.

## References

- [OWASP Authorization Bypass](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/05-Authorization_Testing/)
- [Fail-Closed vs Fail-Open Security Patterns](https://en.wikipedia.org/wiki/Fail-safe_design)
- [Pino Documentation](https://getpino.io/)