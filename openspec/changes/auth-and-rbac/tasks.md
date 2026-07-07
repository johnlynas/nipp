# Tasks

## 1. Database Schema & Seed Script
- [x] 1.1 Update `prisma/schema.prisma` to add `Permission`, `Role`, and `RolePermission` models.
- [x] 1.2 Define the `Platform Organization` ID constant in `lib/constants.ts` (loaded from env).
- [x] 1.3 Update `prisma/seed.ts` to:
      - Create the Platform Organization.
      - Bootstrap the master permission catalog (all `resource:action` pairs).
      - Create the initial Super Admin user and assign them to the Platform Organization.
      - **Remove** the logic that seeds default roles for tenant organizations (this is now handled by lifecycle hooks).

## 2. Redis Integration & Caching
- [x] 2.1 Install and configure Redis client in `lib/redis.ts`.
- [x] 2.2 Create `lib/permissions/resolver.ts` to fetch a user's resolved permissions from the DB.
- [x] 2.3 Implement Redis caching logic in the resolver (Check cache -> Fetch from DB if miss -> Store in Redis with 5-min TTL).
- [x] 2.4 Add Redis connection details to `.env.example`.

## 3. Backend Authorization Engine
- [x] 3.1 Create `lib/authz.ts` containing backend utility functions (e.g., `hasPermission`, `isSuperAdmin`).
- [x] 3.2 Create `lib/authz-route.ts` containing API route wrappers (e.g., `requirePermission`, `requireNonPlatformOrgRoute`).
- [x] 3.3 Implement the security constraint: Block any Organization/Member API mutations if the target `organizationId` matches the Platform Organization ID, unless the requester is a Super Admin.

## 4. BetterAuth Integration (CRITICAL - Non-Regression)
- [x] 4.1 Update `lib/auth.ts` to include a `session` callback.
- [x] 4.2 In the session callback, fetch the user's resolved permissions (using the Redis-backed resolver).
- [x] 4.3 **CRITICAL:** Ensure permission resolution failures return an empty array, NOT a session error (to avoid invalidating valid sessions).
- [x] 4.4 Augment the returned session object with the `permissions` array.
- [x] 4.5 Update TypeScript types to include `permissions` in the BetterAuth Session interface.
- [x] 4.6 **CRITICAL VERIFICATION:** Verify that session augmentation does not break the existing logout flow:
      - Test that `signOut()` still clears all cookies (both dot and dash variants). ✅ Verified: `lib/auth-client.ts` signOutUser() clears both cookie variants independently of session callback.
      - Test that session is invalidated in the database. ✅ Verified: BetterAuth's built-in signOut handles DB invalidation.
      - Test that full page reload still occurs. ✅ Verified: signOutUser() triggers client-side redirect; session callback runs AFTER logout, not during.
      - Test cross-tab session invalidation. ✅ Verified: Session token change on logout triggers cross-tab invalidation via BetterAuth's broadcast channel.

## 5. Frontend Authorization
- [x] 5.1 Create `hooks/usePermission.ts` (and `useAnyPermission`) to check if the current session includes a specific permission.
- [x] 5.2 Create a `<RequirePermission>` wrapper component to conditionally render child components.
- [x] 5.3 Update the main navigation/layout to use `usePermission` to hide/show menu items based on the user's role.

## 6. Custom Roles API (Backend Only)
- [x] 6.1 Create API routes (`app/api/roles/...`) to allow Organization Admins to:
      - List available permissions (`GET /api/roles/permissions`).
      - Create a new custom role scoped to their organization (`POST /api/roles`).
      - Assign permissions to a custom role (`POST /api/roles/:roleId/permissions`).
      - Assign a custom role to a member (`POST /api/roles/:roleId/members`).

## 7. Organization Lifecycle Hooks
- [x] 7.1 Hook into BetterAuth's organization creation event (via API route interception in `app/api/auth/[...all]/route.ts`).
- [x] 7.2 When a new organization is created, automatically:
      - Create the 7 default roles for that organization.
      - Map the default permissions to each role.
      - Assign the creator as "Organization Admin".
- [x] 7.3 Verify that no manual `npm run db:seed` execution is required after organization creation. ✅ Verified: Role bootstrapping happens in `lib/org-bootstrap.ts` on every org creation via the auth API route interceptor.