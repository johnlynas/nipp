# Tasks: Fix Super Admin Auth Bypass

## Phase 1: Centralize Authorization Utility
- [ ] **Task 1.1:** Create `verifySuperAdmin()` function in `lib/authz.ts`
- [ ] **Task 1.2:** Implement database-only membership verification using existing `getPlatformOrgId()`
- [ ] **Task 1.3:** Add structured error logging at `error` level for DB failures
- [ ] **Task 1.4:** Return consistent `{ authorized: boolean; error?: string }` response object

## Phase 2: Update Admin API Routes
- [ ] **Task 2.1:** Update `app/api/admin/organizations/route.ts` GET handler — remove email fallback
- [ ] **Task 2.2:** Update `app/api/admin/organizations/route.ts` POST handler — remove email fallback
- [ ] **Task 2.3:** Update `app/api/admin/organizations/[id]/route.ts` — replace `checkSuperAdmin()` with `verifySuperAdmin()`
- [ ] **Task 2.4:** Update `app/api/admin/organizations/[id]/status/route.ts` — replace `checkSuperAdmin()` with `verifySuperAdmin()`
- [ ] **Task 2.5:** Ensure all routes return appropriate HTTP status codes (401/403/503)

## Phase 3: Logging & Error Handling
- [ ] **Task 3.1:** Verify error-level logging includes userId, timestamp, and error context
- [ ] **Task 3.2:** Add warn-level logging for normal access denials (user lacks membership)
- [ ] **Task 3.3:** Remove all references to `SUPER_ADMIN_EMAIL` from authorization logic

## Phase 4: Testing & Validation
- [ ] **Task 4.1:** Test happy path — super-admin access works with healthy database
- [ ] **Task 4.2:** Simulate DB outage (stop PostgreSQL) and verify `503 Service Unavailable` response
- [ ] **Task 4.3:** Verify no email-based fallback occurs during DB errors
- [ ] **Task 4.4:** Test non-admin user access — verify `403 Forbidden` response
- [ ] **Task 4.5:** Verify error logs are generated at correct severity levels

## Phase 5: Documentation & Deployment
- [ ] **Task 5.1:** Update API documentation to reflect new error responses (403/503)
- [ ] **Task 5.2:** Notify ops team of behavioral change (fail-closed during DB outage)
- [ ] **Task 5.3:** Deploy to staging and verify monitoring alerts trigger on 503 responses
- [ ] **Task 5.4:** Deploy to production
