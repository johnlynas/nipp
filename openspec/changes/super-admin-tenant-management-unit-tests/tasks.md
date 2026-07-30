# Tasks: Super Admin Tenant Management — Unit Tests

## Phase 1: API Route Structural Tests

- [ ] Create `tests/unit/tenant-mgmt-api-structural.test.ts`
- [ ] Add structural tests for `members/route.ts` (GET, POST exports, requireSuperAdmin guard, email validation)
- [ ] Add structural tests for `members/[memberId]/route.ts` (PATCH, DELETE exports, requireSuperAdmin guard, role validation)
- [ ] Add structural tests for `roles/route.ts` (GET, POST exports, requireSuperAdmin guard, name validation)
- [ ] Add structural tests for `roles/[roleId]/route.ts` (PATCH, DELETE exports, requireSuperAdmin guard, name/description validation)
- [ ] Add structural tests for `permissions/route.ts` (GET, PATCH exports, requireSuperAdmin guard, assignments validation)
- [ ] Add structural tests for `settings/route.ts` (PATCH export, requireSuperAdmin guard, name/slug/status validation)
- [ ] Verify all tests pass: `npx vitest run tests/unit/tenant-mgmt-api-structural.test.ts`

## Phase 2: Members API Handler Tests

- [ ] Create `tests/unit/tenant-mgmt-members.test.ts`
- [ ] Mock `@/lib/global-db`, `@/lib/tenant-db`, `@/lib/tenant-context`, `@/lib/require-super-admin`, `@/lib/audit-log`, `@/lib/logger`
- [ ] Test GET members — happy path (returns member list with user and role data)
- [ ] Test GET members — org not found (returns 404)
- [ ] Test GET members — unauthorized (returns 403)
- [ ] Test GET members — database unavailable (returns 503)
- [ ] Test POST members — happy path (creates user if missing, creates member, returns 201)
- [ ] Test POST members — email required (returns 400)
- [ ] Test POST members — org not found (returns 404)
- [ ] Test POST members — user already a member (returns 409)
- [ ] Test POST members — unauthorized (returns 403)
- [ ] Test POST members — database unavailable (returns 503)
- [ ] Verify all tests pass: `npx vitest run tests/unit/tenant-mgmt-members.test.ts`

## Phase 3: Roles API Handler Tests

- [ ] Create `tests/unit/tenant-mgmt-roles.test.ts`
- [ ] Mock dependencies (same as Phase 2)
- [ ] Test GET roles — happy path (returns role list with permissions and member counts)
- [ ] Test GET roles — org not found (returns 404)
- [ ] Test GET roles — unauthorized (returns 403)
- [ ] Test GET roles — database unavailable (returns 503)
- [ ] Test POST roles — happy path (creates role, returns 201)
- [ ] Test POST roles — name required (returns 400)
- [ ] Test POST roles — org not found (returns 404)
- [ ] Test POST roles — duplicate role name (returns 409)
- [ ] Test POST roles — unauthorized (returns 403)
- [ ] Test POST roles — database unavailable (returns 503)
- [ ] Verify all tests pass: `npx vitest run tests/unit/tenant-mgmt-roles.test.ts`

## Phase 4: Roles Detail API Handler Tests

- [ ] Create `tests/unit/tenant-mgmt-roles.test.ts` (extend with PATCH and DELETE tests)
- [ ] Test PATCH role — happy path (updates name/description, returns updated role)
- [ ] Test PATCH role — name or description required (returns 400)
- [ ] Test PATCH role — org not found (returns 404)
- [ ] Test PATCH role — role not found in org (returns 404)
- [ ] Test PATCH role — unauthorized (returns 403)
- [ ] Test DELETE role — happy path (deletes role, returns success message)
- [ ] Test DELETE role — org not found (returns 404)
- [ ] Test DELETE role — role not found in org (returns 404)
- [ ] Test DELETE role — role has assigned members (returns 400 with count)
- [ ] Test DELETE role — unauthorized (returns 403)
- [ ] Verify all tests pass: `npx vitest run tests/unit/tenant-mgmt-roles.test.ts`

## Phase 5: Permissions API Handler Tests

- [ ] Create `tests/unit/tenant-mgmt-permissions.test.ts`
- [ ] Mock dependencies (same as Phase 2)
- [ ] Test GET permissions — happy path (returns roles grid with permission assignments)
- [ ] Test GET permissions — org not found (returns 404)
- [ ] Test GET permissions — unauthorized (returns 403)
- [ ] Test GET permissions — database unavailable (returns 503)
- [ ] Test PATCH permissions — happy path (assigns/revokes permissions, returns results)
- [ ] Test PATCH permissions — assignments required (returns 400)
- [ ] Test PATCH permissions — org not found (returns 404)
- [ ] Test PATCH permissions — invalid role in assignments (marks as failed, continues processing others)
- [ ] Test PATCH permissions — invalid permission key in assignments (marks as failed, continues processing others)
- [ ] Test PATCH permissions — unauthorized (returns 403)
- [ ] Verify all tests pass: `npx vitest run tests/unit/tenant-mgmt-permissions.test.ts`

## Phase 6: Settings API Handler Tests

- [ ] Create `tests/unit/tenant-mgmt-settings.test.ts`
- [ ] Mock dependencies (same as Phase 2)
- [ ] Test PATCH settings — happy path (updates name/slug/status, returns updated org)
- [ ] Test PATCH settings — at least one field required (returns 400)
- [ ] Test PATCH settings — org not found (returns 404)
- [ ] Test PATCH settings — invalid status transition (returns 400 with state machine error)
- [ ] Test PATCH settings — slug collision (returns 409)
- [ ] Test PATCH settings — SUSPENDED status invalidates sessions (verifies session.deleteMany called)
- [ ] Test PATCH settings — ARCHIVED status logs warning for active members (verifies logger.warn called)
- [ ] Test PATCH settings — unauthorized (returns 403)
- [ ] Verify all tests pass: `npx vitest run tests/unit/tenant-mgmt-settings.test.ts`

## Phase 7: UI Component Tests — TenantMemberForm

- [ ] Create `tests/unit/TenantMemberForm.test.tsx`
- [ ] Add `@vitest-environment jsdom` directive at top of file
- [ ] Test renders email input with correct label and placeholder
- [ ] Test renders role select with default value "member"
- [ ] Test renders submit button with text "Add Member"
- [ ] Test renders cancel button with text "Cancel"
- [ ] Test calls onSubmit with email and role when form submitted with valid data
- [ ] Test trims whitespace from email before submitting
- [ ] Test does not call onSubmit when email is empty/whitespace only
- [ ] Test calls onCancel when cancel button clicked
- [ ] Test disables submit button and shows "Adding..." text while submitting (async)
- [ ] Test re-enables submit button after submission completes
- [ ] Verify all tests pass: `npx vitest run tests/unit/TenantMemberForm.test.tsx`

## Phase 8: UI Component Tests — TenantRoleForm

- [ ] Create `tests/unit/TenantRoleForm.test.tsx`
- [ ] Add `@vitest-environment jsdom` directive at top of file
- [ ] Test renders name input with correct label and placeholder
- [ ] Test renders description input with correct label and placeholder
- [ ] Test renders submit button with text "Create Role"
- [ ] Test renders cancel button with text "Cancel"
- [ ] Test calls onSubmit with name and description when form submitted with valid data
- [ ] Test trims whitespace from name before submitting
- [ ] Test does not call onSubmit when name is empty/whitespace only
- [ ] Test calls onCancel when cancel button clicked
- [ ] Test disables submit button and shows "Creating..." text while submitting (async)
- [ ] Test re-enables submit button after submission completes
- [ ] Verify all tests pass: `npx vitest run tests/unit/TenantRoleForm.test.tsx`

## Phase 9: State Machine Tests Extension

- [ ] Modify `tests/unit/org-state-machine.test.ts`
- [ ] Add tests for settings route VALID_TRANSITIONS (ACTIVE → PENDING allowed in settings, unlike org-mgmt)
- [ ] Verify all tests pass: `npx vitest run tests/unit/org-state-machine.test.ts`

## Phase 10: Final Verification

- [ ] Run all unit tests: `npm test` — verify zero failures
- [ ] Run only new tenant management tests: `npx vitest run tests/unit/tenant-mgmt-*.test.ts tests/unit/TenantMemberForm.test.tsx tests/unit/TenantRoleForm.test.tsx`
- [ ] Verify test execution time < 10 seconds
- [ ] Run with coverage: `npx vitest run --coverage tests/unit/tenant-mgmt-*.test.ts`
- [ ] Verify TypeScript compiles: `npx tsc --noEmit` — zero errors
- [ ] Verify ESLint passes: `npx eslint . --max-warnings=0` — zero errors
