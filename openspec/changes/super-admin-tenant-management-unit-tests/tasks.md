# Tasks: Super Admin Tenant Management — Unit Tests

## Phase 1: API Route Structural Tests

- [x] Create `tests/unit/tenant-mgmt-api-structural.test.ts`
- [x] Add structural tests for `members/route.ts` (GET, POST exports, requireSuperAdmin guard, email validation)
- [x] Add structural tests for `members/[memberId]/route.ts` (PATCH, DELETE exports, requireSuperAdmin guard, role validation)
- [x] Add structural tests for `roles/route.ts` (GET, POST exports, requireSuperAdmin guard, name validation)
- [x] Add structural tests for `roles/[roleId]/route.ts` (PATCH, DELETE exports, requireSuperAdmin guard, name/description validation)
- [x] Add structural tests for `permissions/route.ts` (GET, PATCH exports, requireSuperAdmin guard, assignments validation)
- [x] Add structural tests for `settings/route.ts` (PATCH export, requireSuperAdmin guard, name/slug/status validation)
- [x] Verify all tests pass: `npx vitest run tests/unit/tenant-mgmt-api-structural.test.ts`

## Phase 2: Members API Handler Tests

- [x] Create `tests/unit/tenant-mgmt-members.test.ts`
- [x] Mock `@/lib/global-db`, `@/lib/tenant-db`, `@/lib/tenant-context`, `@/lib/require-super-admin`, `@/lib/audit-log`, `@/lib/logger`
- [x] Test GET members — happy path (returns member list with user and role data)
- [x] Test GET members — org not found (returns 404)
- [x] Test GET members — unauthorized (returns 403)
- [x] Test GET members — database unavailable (returns 503)
- [x] Test POST members — happy path (creates user if missing, creates member, returns 201)
- [x] Test POST members — email required (returns 400)
- [x] Test POST members — org not found (returns 404)
- [x] Test POST members — user already a member (returns 409)
- [x] Test POST members — unauthorized (returns 403)
- [x] Test POST members — database unavailable (returns 503)
- [x] Verify all tests pass: `npx vitest run tests/unit/tenant-mgmt-members.test.ts`

## Phase 3: Roles API Handler Tests

- [x] Create `tests/unit/tenant-mgmt-roles.test.ts`
- [x] Mock dependencies (same as Phase 2)
- [x] Test GET roles — happy path (returns role list with permissions and member counts)
- [x] Test GET roles — org not found (returns 404)
- [x] Test GET roles — unauthorized (returns 403)
- [x] Test GET roles — database unavailable (returns 503)
- [x] Test POST roles — happy path (creates role, returns 201)
- [x] Test POST roles — name required (returns 400)
- [x] Test POST roles — org not found (returns 404)
- [x] Test POST roles — duplicate role name (returns 409)
- [x] Test POST roles — unauthorized (returns 403)
- [x] Test POST roles — database unavailable (returns 503)
- [x] Verify all tests pass: `npx vitest run tests/unit/tenant-mgmt-roles.test.ts`

## Phase 4: Roles Detail API Handler Tests

- [x] Create `tests/unit/tenant-mgmt-roles.test.ts` (extend with PATCH and DELETE tests)
- [x] Test PATCH role — happy path (updates name/description, returns updated role)
- [x] Test PATCH role — name or description required (returns 400)
- [x] Test PATCH role — org not found (returns 404)
- [x] Test PATCH role — role not found in org (returns 404)
- [x] Test PATCH role — unauthorized (returns 403)
- [x] Test DELETE role — happy path (deletes role, returns success message)
- [x] Test DELETE role — org not found (returns 404)
- [x] Test DELETE role — role not found in org (returns 404)
- [x] Test DELETE role — role has assigned members (returns 400 with count)
- [x] Test DELETE role — unauthorized (returns 403)
- [x] Verify all tests pass: `npx vitest run tests/unit/tenant-mgmt-roles.test.ts`

## Phase 5: Permissions API Handler Tests

- [x] Create `tests/unit/tenant-mgmt-permissions.test.ts`
- [x] Mock dependencies (same as Phase 2)
- [x] Test GET permissions — happy path (returns roles grid with permission assignments)
- [x] Test GET permissions — org not found (returns 404)
- [x] Test GET permissions — unauthorized (returns 403)
- [x] Test GET permissions — database unavailable (returns 503)
- [x] Test PATCH permissions — happy path (assigns/revokes permissions, returns results)
- [x] Test PATCH permissions — assignments required (returns 400)
- [x] Test PATCH permissions — org not found (returns 404)
- [x] Test PATCH permissions — invalid role in assignments (marks as failed, continues processing others)
- [x] Test PATCH permissions — invalid permission key in assignments (marks as failed, continues processing others)
- [x] Test PATCH permissions — unauthorized (returns 403)
- [x] Verify all tests pass: `npx vitest run tests/unit/tenant-mgmt-permissions.test.ts`

## Phase 6: Settings API Handler Tests

- [x] Create `tests/unit/tenant-mgmt-settings.test.ts`
- [x] Mock dependencies (same as Phase 2)
- [x] Test PATCH settings — happy path (updates name/slug/status, returns updated org)
- [x] Test PATCH settings — at least one field required (returns 400)
- [x] Test PATCH settings — org not found (returns 404)
- [x] Test PATCH settings — invalid status transition (returns 400 with state machine error)
- [x] Test PATCH settings — slug collision (returns 409)
- [x] Test PATCH settings — SUSPENDED status invalidates sessions (verifies session.deleteMany called)
- [x] Test PATCH settings — ARCHIVED status logs warning for active members (verifies logger.warn called)
- [x] Test PATCH settings — unauthorized (returns 403)
- [x] Verify all tests pass: `npx vitest run tests/unit/tenant-mgmt-settings.test.ts`

## Phase 7: UI Component Tests — TenantMemberForm

- [x] Create `tests/unit/TenantMemberForm.test.tsx`
- [x] Add `@vitest-environment jsdom` directive at top of file
- [x] Test renders email input with correct label and placeholder
- [x] Test renders role select with default value "member"
- [x] Test renders submit button with text "Add Member"
- [x] Test renders cancel button with text "Cancel"
- [x] Test calls onSubmit with email and role when form submitted with valid data
- [x] Test trims whitespace from email before submitting
- [x] Test does not call onSubmit when email is empty/whitespace only
- [x] Test calls onCancel when cancel button clicked
- [x] Test disables submit button and shows "Adding..." text while submitting (async)
- [x] Test re-enables submit button after submission completes
- [x] Verify all tests pass: `npx vitest run tests/unit/TenantMemberForm.test.tsx`

## Phase 8: UI Component Tests — TenantRoleForm

- [x] Create `tests/unit/TenantRoleForm.test.tsx`
- [x] Add `@vitest-environment jsdom` directive at top of file
- [x] Test renders name input with correct label and placeholder
- [x] Test renders description input with correct label and placeholder
- [x] Test renders submit button with text "Create Role"
- [x] Test renders cancel button with text "Cancel"
- [x] Test calls onSubmit with name and description when form submitted with valid data
- [x] Test trims whitespace from name before submitting
- [x] Test does not call onSubmit when name is empty/whitespace only
- [x] Test calls onCancel when cancel button clicked
- [x] Test disables submit button and shows "Creating..." text while submitting (async)
- [x] Test re-enables submit button after submission completes
- [x] Verify all tests pass: `npx vitest run tests/unit/TenantRoleForm.test.tsx`

## Phase 9: State Machine Tests Extension

- [x] Modify `tests/unit/org-state-machine.test.ts`
- [x] Add tests for settings route VALID_TRANSITIONS (ACTIVE → PENDING allowed in settings, unlike org-mgmt)
- [x] Verify all tests pass: `npx vitest run tests/unit/org-state-machine.test.ts`

## Phase 10: Final Verification

- [x] Run all unit tests: `npm test` — verify zero failures (290 passed, 30 files)
- [x] Run only new tenant management tests: `npx vitest run tests/unit/tenant-mgmt-*.test.ts tests/unit/TenantMemberForm.test.tsx tests/unit/TenantRoleForm.test.tsx` (175 passed)
- [x] Verify test execution time < 10 seconds (~1.4s total)
- [x] Run with coverage: `npx vitest run --coverage tests/unit/tenant-mgmt-*.test.ts`
- [x] Verify TypeScript compiles: `npx tsc --noEmit` — zero errors
- [x] Verify ESLint passes: `npx eslint . --max-warnings=0` — zero errors