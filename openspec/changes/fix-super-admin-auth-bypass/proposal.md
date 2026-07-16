# Fix: Super Admin Auth Bypass via Email Fallback

**Status:** Proposed  
**Author:** Property NI Development Team  
**Created:** 2026-07-15  
**Last Updated:** 2026-07-15  
**Related Issues:** Critical Issue #2 — Email-based super admin fallback is an auth bypass

---

## Summary

This proposal addresses a critical security vulnerability where multiple admin API routes fall back to an email-based authorization check when the database is unavailable. This "fail-open" behavior allows anyone with a valid session for the configured `SUPER_ADMIN_EMAIL` to bypass all database-backed authorization checks, effectively granting unrestricted super-admin access during outages or errors.

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

## Detailed Design

### Remove Email Fallback Entirely
The database must be the authoritative source for authorization decisions. If the database is unavailable, access should be denied with a clear error response and an error-level log entry.

### Centralize Authorization Logic
Extract the super-admin check into a dedicated utility function that:
- Always queries the database for membership verification
- Logs errors at `error` level when authorization checks fail
- Returns a consistent error response (`401 Unauthorized` or `503 Service Unavailable`) when the database is unreachable

### Update Affected Routes
Replace all `try/catch` fallback patterns in:
- `app/api/admin/organizations/route.ts` (GET and POST handlers)
- `app/api/admin/organizations/[id]/route.ts` (`checkSuperAdmin` helper)
- `app/api/admin/organizations/[id]/status/route.ts` (`checkSuperAdmin` helper)

See [design.md](./design.md) for complete technical details.

## Files to Create or Modify

### Modified Files
- `app/api/admin/organizations/route.ts` — Remove email fallback from GET and POST handlers
- `app/api/admin/organizations/[id]/route.ts` — Remove email fallback from `checkSuperAdmin` helper
- `app/api/admin/organizations/[id]/status/route.ts` — Remove email fallback from `checkSuperAdmin` helper
- `lib/authz.ts` (optional) — Consider adding a centralized `verifySuperAdmin()` function if pattern repeats elsewhere

## Testing Plan

1. **Happy Path:** Verify super-admin access works when database is healthy and user has proper membership.
2. **Database Unavailable:** Simulate DB outage (e.g., stop PostgreSQL) and verify:
   - Requests return `503 Service Unavailable` or `401 Unauthorized` (not 200 OK)
   - Error is logged at `error` level with clear message
   - No fallback to email-based access occurs
3. **Invalid Session:** Verify non-admin users are still rejected with `401/403`
4. **Missing SUPER_ADMIN_EMAIL:** Verify the system does not default to `admin@nipp.gov.uk`

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Admin routes fail during DB maintenance | Medium | Implement graceful degradation with clear error messages; ensure monitoring alerts on 503 responses |
| Existing deployments rely on fallback behavior | Low | Document breaking change; communicate to ops team before deployment |
| Increased error logging volume | Low | Log only on actual authorization failures, not on every request |

## Implementation Timeline

1. **Phase 1:** Extract super-admin verification into a centralized utility function
2. **Phase 2:** Update all affected admin API routes to use the new utility and remove fallback logic
3. **Phase 3:** Add error-level logging for authorization failures
4. **Phase 4:** Test database outage scenarios and verify fail-closed behavior

See [tasks.md](./tasks.md) for detailed implementation checklist.

## Acceptance Criteria

- [ ] All `try/catch` email fallback patterns removed from admin API routes
- [ ] Authorization failures log at `error` level with clear context
- [ ] Database unavailability returns appropriate error response (401/503), not 200 OK
- [ ] No hardcoded default email (`admin@nipp.gov.uk`) exists in authorization logic
- [ ] Tests verify fail-closed behavior during simulated DB outage

## References

- [OWASP Authorization Bypass](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/05-Authorization_Testing/)
- [Fail-Closed vs Fail-Open Security Patterns](https://en.wikipedia.org/wiki/Fail-safe_design)
