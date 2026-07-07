# Design: Authorization & Role-Based Access Control (RBAC)

## Technical Approach
- **Permission Syntax:** `resource:action` (e.g., `properties:create`, `tenants:delete`).
- **Storage:** Permissions and Role mappings stored in PostgreSQL.
- **Caching:** Redis used to cache resolved permission sets per user with a 5-minute TTL.
- **Frontend:** Permissions injected into the BetterAuth session object, accessed via a `usePermission` hook.

## Architecture Decisions

### Decision: Platform Organization for Super Admins
The system will use a dedicated "Platform Organization" to house Super Admins and support staff, rather than a boolean flag on the User table.
*Why:* This treats support staff as an actual organization within the system, allowing them to have their own internal roles and permissions. The Platform Organization ID will be hardcoded/environment-configured. The system will explicitly block any API calls attempting to invite users to or modify this Organization unless the requester is already a verified Super Admin.

### Decision: Database-Backed Permission Catalog
The master catalog of all available permissions will be stored in the database, not hardcoded in the application.
*Why:* Storing permissions in the DB allows for dynamic management and reporting. The catalog will be bootstrapped and kept in sync via the existing `prisma/seed.ts` script.

### Decision: Redis Caching with TTL
User permissions will be fetched from the database upon first request and cached in Redis with a 5-minute Time-To-Live (TTL).
*Why:* Permissions are checked on almost every request. Hitting the database every time is a performance bottleneck. A 5-minute TTL provides a balance between performance and consistency, accepting a slight delay when an Org Admin updates a role's permissions.

### Decision: Session Augmentation for Frontend
The resolved permissions will be augmented into the BetterAuth session object upon login.
*Why:* This prevents the frontend from needing to make a separate API call to fetch permissions on initial load. The `usePermission` hook can immediately evaluate UI rendering based on the session data.

### Decision: Safe Session Augmentation (Non-Regression)
Permission resolution will be injected into the BetterAuth session callback, but MUST NOT interfere with session validation or destruction.
*Why:* The session callback is called on every request to validate the session. We must ensure that:
1. Permission resolution failures return an empty array, NOT a session error (to avoid invalidating valid sessions).
2. Session destruction (logout) still clears all cookies and database records.
3. Cross-tab session invalidation continues to work.

### Decision: Automatic Role Bootstrapping for New Organizations
When a new tenant organization is created via BetterAuth's organization plugin, the system MUST automatically bootstrap the 7 default roles and their permission mappings.
*Why:* Requiring manual `npm run db:seed` execution after every organization creation is error-prone and creates a poor user experience. We will hook into BetterAuth's organization creation lifecycle to automatically seed default roles.

### Decision: `resource:action` Permission Syntax
Permissions will follow a strict `resource:action` naming convention.
*Why:* This provides a standardized, predictable, and scalable way to define permissions across all domains (e.g., `properties:view`, `financials:export`).