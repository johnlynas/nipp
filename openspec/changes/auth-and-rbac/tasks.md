# Tasks

## 1. Database Schema & Seed Script
- [ ] 1.1 Update `prisma/schema.prisma` to add `Permission`, `Role`, and `RolePermission` models.
- [ ] 1.2 Define the `Platform Organization` ID constant in `lib/constants.ts` (loaded from env).
- [ ] 1.3 Update `prisma/seed.ts` to:
      - Create the Platform Organization.
      - Bootstrap the master permission catalog (all `resource:action` pairs).
      - Create the initial Super Admin user and assign them to the Platform Organization.
      - **Remove** the logic that seeds default roles for tenant organizations (this is now handled by lifecycle hooks).

## 2. Redis Integration & Caching
- [ ] 2.1 Install and configure Redis client in `lib/redis.ts`.
- [ ] 2.2 Create `lib/permissions/resolver.ts` to fetch a user's resolved permissions from the DB.
- [ ] 2.3 Implement Redis caching logic in the resolver (Check cache -> Fetch from DB if miss -> Store in Redis with 5-min TTL).
- [ ] 2.4 Add Redis connection details to `.env.example`.

## 3. Backend Authorization Engine
- [ ] 3.1 Create `lib/authz.ts` containing backend utility functions (e.g., `hasPermission`, `isSuperAdmin`).
- [ ] 3.2 Create `lib/authz-route.ts` containing API route wrappers (e.g., `requirePermission`, `requireNonPlatformOrgRoute`).
- [ ] 3.3 Implement the security constraint: Block any Organization/Member API mutations if the target `organizationId` matches the Platform Organization ID, unless the requester is a Super Admin.

## 4. BetterAuth Integration (CRITICAL - Non-Regression)
- [ ] 4.1 Update `lib/auth.ts` to include a `session` callback.
- [ ] 4.2 In the session callback, fetch the user's resolved permissions (using the Redis-backed resolver).
- [ ] 4.3 **CRITICAL:** Ensure permission resolution failures return an empty array, NOT a session error (to avoid invalidating valid sessions).
- [ ] 4.4 Augment the returned session object with the `permissions` array.
- [ ] 4.5 Update TypeScript types to include `permissions` in the BetterAuth Session interface.
- [ ] 4.6 **CRITICAL VERIFICATION:** Verify that session augmentation does not break the existing logout flow:
      - Test that `signOut()` still clears all cookies (both dot and dash variants).
      - Test that session is invalidated in the database.
      - Test that full page reload still occurs.
      - Test cross-tab session invalidation.

## 5. Frontend Authorization
- [ ] 5.1 Create `hooks/usePermission.ts` (and `useAnyPermission`) to check if the current session includes a specific permission.
- [ ] 5.2 Create a `<RequirePermission>` wrapper component to conditionally render child components.
- [ ] 5.3 Update the main navigation/layout to use `usePermission` to hide/show menu items based on the user's role.

## 6. Custom Roles API (Backend Only)
- [ ] 6.1 Create API routes (`app/api/roles/...`) to allow Organization Admins to:
      - List available permissions (`GET /api/roles/permissions`).
      - Create a new custom role scoped to their organization (`POST /api/roles`).
      - Assign permissions to a custom role (`POST /api/roles/:roleId/permissions`).
      - Assign a custom role to a member (`POST /api/roles/:roleId/members`).

## 7. Organization Lifecycle Hooks
- [ ] 7.1 Hook into BetterAuth's organization creation event (via `onCreateOrganization` or equivalent plugin hook).
- [ ] 7.2 When a new organization is created, automatically:
      - Create the 7 default roles for that organization.
      - Map the default permissions to each role.
      - Assign the creator as "Organization Admin".
- [ ] 7.3 Verify that no manual `npm run db:seed` execution is required after organization creation.