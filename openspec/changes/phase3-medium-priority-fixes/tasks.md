# Phase 3 Medium Priority Fixes - Tasks

## Task Breakdown

### Task 1: [P3] Optimize Session Invalidation
**Effort:** 2 hours  
**File:** `app/api/admin/organizations/[id]/status/route.ts`

- [x] Replace sequential Redis DEL loop with batch `redis.del(...keys)`
- [ ] Add logging for batch operation count
- [ ] Test with org having 100+ members

```typescript
// Before:
for (const key of sessionIds) {
  await redis.del(key);
}

// After:
if (redis && sessionIds.length > 0) {
  await redis.del(...sessionIds);
}
```

---

### Task 2: [P7] Add Server-Side Caching to API Routes
**Effort:** 6 hours  
**Files:** 8 GET route files + 6 mutation routes in `app/api/`

- [x] Add cache directives to GET routes:
  - `app/api/admin/organizations/route.ts` → `revalidate: 30`
  - `app/api/admin/organizations/[id]/route.ts` → `unstable_cache` (30s, tag: `org`)
  - `app/api/admin/permissions/route.ts` → `revalidate: 60`
  - `app/api/admin/system-logs/route.ts` → `revalidate: 10`
  - `app/api/admin/audit-logs/route.ts` → `revalidate: 10`
  - `app/api/roles/permissions/route.ts` → `revalidate: 60`
  - `app/api/auth/permissions/route.ts` → `revalidate: 0`
  - `app/api/auth/user-permissions/route.ts` → `revalidate: 0`
- [x] Add cache invalidation to mutation routes using `revalidateTag()`:
  - `PATCH /api/admin/organizations/[id]/status` → `revalidateTag('org')`
  - `DELETE /api/admin/organizations/[id]` → `revalidateTag('org')`
  - `POST /api/roles` → `revalidateTag('org')`
  - `POST /api/roles/[roleId]/members` → `revalidateTag('org')`
  - `POST /api/roles/[roleId]/permissions` → `revalidateTag('org')`
  - `POST/PATCH/DELETE /api/admin/permissions` → `revalidateTag('permission')`
- [ ] Verify cached responses return correct data; test cache invalidation on mutations

---

### Task 3: [P9] Fix RequirePermission Hooks Violation
**Effort:** 1 hour  
**File:** `components/auth/RequirePermission.tsx`

- [x] Move all hook calls to top level (unconditional)
- [ ] Test with single string permission
- [ ] Test with array permission (mode='any')
- [ ] Test with array permission (mode='all')

---

### Task 4: [S9] CSP 'unsafe-inline' for Styles — Partial Fix
**Effort:** 2 hours  
**File:** `middleware.ts` + components

- [x] Convert login page inline styles to Tailwind classes ✅
- [x] Convert ConfirmDialog inline styles to Tailwind classes ✅
- [ ] Revert CSP `style-src` back to `'unsafe-inline'` (React/Next.js apply inline styles at runtime that can't be given nonces)
- [ ] Document this as a known limitation/trade-off

**Note:** Full removal of `'unsafe-inline'` requires framework-level changes to handle React/Next.js internal inline styles. This is deferred to a future phase.

---

### Task 5: [S10] Remove Sensitive Data from Health Endpoint
**Effort:** 30 minutes  
**File:** `app/api/health/route.ts`

- [x] Remove `version` from response JSON
- [ ] Keep endpoint publicly accessible (required for monitoring)
- [ ] Endpoint remains public but no longer exposes server version

```typescript
// Before:
return NextResponse.json({
  status: overallStatus,
  timestamp: new Date().toISOString(),
  version: process.env.npm_package_version || '0.1.0',
  uptime: Math.floor(process.uptime()),
  checks,
}, { status: statusCode });

// After:
return NextResponse.json({
  status: overallStatus,
  timestamp: new Date().toISOString(),
  uptime: Math.floor(process.uptime()), // Server uptime in seconds (useful for admins)
  checks,
}, { status: statusCode });
```

---

### Task 6: [S12] Fix Permission RLS Policy
**Effort:** 3 hours  
**File:** New migration file

- [ ] Create new Prisma migration:
  ```sql
  DROP POLICY permission_read_all ON "Permission";
  
  CREATE POLICY permission_org_isolation ON "Permission"
    FOR SELECT
    USING (
      -- Platform admins can read all permissions
      EXISTS (
        SELECT 1 FROM "Member" m
        WHERE m."userId" = current_setting('app.current_user_id', true)
          AND m."orgId" = current_setting('app.platform_org_id', true)
      )
      OR
      -- Regular users can read permissions assigned to their org's roles
      EXISTS (
        SELECT 1 FROM "RolePermission" rp
        JOIN "Role" r ON rp."roleId" = r.id
        WHERE rp."permissionId" = "Permission".id
          AND rp."organizationId"::text = current_setting('app.current_org_id', true)
      )
    );
  ```
- [ ] Run migration in test environment
- [ ] Verify permission queries still work for org members
- [ ] Verify super admin can still read all permissions

---

## Execution Order

1. **Task 3** (P9) - Lowest risk, quick win
2. **Task 1** (P3) - Simple code change, high impact
3. **Task 5** (S10) - Security fix, minimal change (removed version/uptime)
4. **Task 6** (S12) - Database migration, needs testing
5. **Task 4** (S9) - May require component changes
6. **Task 2** (P7) - Most files to change, needs monitoring

## Total Estimated Effort: 17 hours (~2 sprints)
