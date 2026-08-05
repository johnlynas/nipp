# Design: Data Model Services

## Technical Approach
- **Service Location:** All services live under `services/` (or `lib/services/` for shared types/base utilities)
- **Authorization:** Service-layer authorization using a `ServiceContext` object passed to every method (Option A)
- **DB Access:** 
  - `UserService` and `PermissionService` use `globalDb` (both models are global, non-org-scoped)
  - `RoleService` uses `tenantDb` within a tenant context (org-scoped model)
  - `OrganizationService` uses `globalDb` for the Organization model (global, not org-scoped)
- **Error Handling:** Typed error classes (`UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `ValidationError`)
- **Shared Error Mapper:** A shared `handleServiceError()` utility maps error types to HTTP responses, used by all refactored API routes
- **Testing:** Vitest for unit tests; integration and E2E tests use the test database

## Architecture Decisions

### Decision: Service-Layer Authorization (Option A)
Place authorization logic inside the service layer rather than relying solely on API route guards.

*Why:* This ensures that even if a service is called from an unprotected route, it will validate the requester's authority. It also makes services reusable across different entry points (API routes, scheduled jobs, admin scripts) without duplicating authorization logic.

```typescript
// ServiceContext passed to every method
interface ServiceContext {
  userId: string;
  role: 'PLATFORM_ADMIN' | 'TENANT_ADMIN' | 'MEMBER';
  organizationId?: string; // The org the user belongs to/is acting within
}

// Multi-org resolution rule: ctx.organizationId is set by the route that constructed
// the context. For Platform Admins, this is typically undefined or the Platform org ID.
// The route that calls a service method must always pass an explicit targetOrgId for
// org-scoped operations.

// Example: RoleService.create()
async create(data: CreateRoleInput, targetOrgId: string, ctx: ServiceContext) {
  // Platform Admin can create roles in any org (targetOrgId is explicit, not from ctx)
  if (ctx.role === 'PLATFORM_ADMIN') {
    // targetOrgId must be provided for org-scoped models
  }
  
  // Tenant Admin can only create roles in their own org
  if (ctx.role === 'TENANT_ADMIN') {
    if (targetOrgId !== ctx.organizationId) {
      throw new ForbiddenError('Cannot create roles outside your organization');
    }
  }
  
  // MEMBER is denied all operations (checked by base-service authorize())
  
  // ... proceed with creation via tenantDb
}
```

### Decision: `organizationId` Scoping Pattern
All services must use the existing `organizationId` pattern from the Prisma schema. No new scoping mechanism is introduced.

*Why:* This preserves compatibility with the Prisma Extension (tenant-db.ts) and PostgreSQL RLS policies. The defense-in-depth strategy remains intact.

### Decision: Shared Types in `lib/services/types.ts`
Define all shared interfaces (ServiceContext, pagination, error types) in a single file.

*Why:* Prevents duplication across service files and ensures consistency. Any consumer of the services can import from this single source of truth.

### Decision: Typed Error Classes
Use custom error classes that extend `Error` with typed properties for structured error handling.

*Why:* API routes can inspect the error type to return appropriate HTTP status codes (400, 401, 403, 404, 409) without try/catch gymnastics.

```typescript
class ValidationError extends Error { code: 'VALIDATION_ERROR'; status: 400; }
class UnauthorizedError extends Error { code: 'UNAUTHORIZED'; status: 401; }
class ForbiddenError extends Error { code: 'FORBIDDEN'; status: 403; }
class NotFoundError extends Error { code: 'NOT_FOUND'; status: 404; }
class ConflictError extends Error { code: 'CONFLICT'; status: 409; }
```

**Prisma P2002 mapping:** Unique constraint violations (e.g., duplicate role name, duplicate permission key) are caught and translated to `ConflictError` by the service layer.

**UnauthorizedError usage:** Thrown when `ctx.userId` is missing or empty — a programming error indicating the service was called without proper context construction.

### Decision: Authorization Helper Functions (Not a Class)
`lib/services/base-service.ts` exports **functions**, not a class. These are pure authorization utilities used by all services.

*Why:* Consistent with the existing singleton service pattern; avoids unnecessary class instantiation overhead in Node.js.

```typescript
// lib/services/base-service.ts exports:

/** Throws ForbiddenError if ctx.role !== 'PLATFORM_ADMIN' */
export function requirePlatformAdmin(ctx: ServiceContext): void

/** Throws ForbiddenError if ctx.role !== 'TENANT_ADMIN' or targetOrgId !== ctx.organizationId */
export function requireTenantAdmin(ctx: ServiceContext, targetOrgId: string): void

/** Throws ForbiddenError if ctx.role === 'MEMBER' */
export function requireAnyAdmin(ctx: ServiceContext): void

/** Resolves the effective target org ID based on context and explicit parameter.
 *  Returns targetOrgId if provided, otherwise ctx.organizationId.
 *  Throws ValidationError if neither is available for an org-scoped operation. */
export function resolveOrgScope(
  ctx: ServiceContext, 
  targetOrgId?: string
): string

/** Logs a failed authorization attempt for security observability */
export function logFailedAuth(ctx: ServiceContext, action: string): void
```

**Semantics:**
- `requireTenantAdmin` throws for both `MEMBER` and `PLATFORM_ADMIN` (with different messages)
- `resolveOrgScope` returns the explicit `targetOrgId` if provided; otherwise falls back to `ctx.organizationId`. For Platform Admins operating on org-scoped models, the route must always provide an explicit `targetOrgId`.
- If `ctx.organizationId` is undefined and no `targetOrgId` is provided, `resolveOrgScope` throws `ValidationError('organizationId required for this operation')`.

### Decision: Safety Checks on Destructive Operations
`delete()` methods for Role, Permission, and Organization models include safety checks:

- **Role:** Throws `ConflictError` if members are assigned to the role (query `MemberRole` count)
- **Permission:** Throws `ConflictError` if the permission is assigned to any role (query `RolePermission` count)
- **Organization:** 
  - Throws `ConflictError` if the organization has any members (query `Member` count)
  - **Platform Organization is protected:** If the target org's slug matches the Platform Organization identifier (configured via env var `PLATFORM_ORG_SLUG`), throws `ForbiddenError('Cannot delete the Platform Organization')`
  - This is a **hard delete** — all cascading deletes (members, roles, role-permissions) are handled by Prisma's `onDelete: Cascade` relations

### Decision: Pagination Standard
All `list()` methods return a standardized paginated response shape:

```typescript
interface PaginatedResult<T> {
  items: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

interface PaginationInput {
  page?: number;       // default: 1, min: 1
  pageSize?: number;   // default: 20, max: 100 (prevents abuse)
}

// Validation rules:
// - page < 1 → coerced to 1, logged as warning
// - pageSize > 100 → capped at 100, logged as warning
// - pageSize < 1 or non-numeric → ValidationError thrown
```

### Decision: Filter Standardization
Each service defines its own filter types, but all follow a common pattern:

```typescript
// Common filter fields available across services where applicable:
interface BaseFilters {
  search?: string;       // case-insensitive substring match on name field
}

// Organization filters:
interface OrganizationFilters extends BaseFilters {
  status?: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
}

// User filters (Tenant Admin scope: only members of their org):
interface UserFilters extends BaseFilters {
  role?: string;         // filter by member role within the org
}

// Role filters:
interface RoleFilters extends BaseFilters {
  isDefault?: boolean;   // filter by default vs custom roles
}

// Permission filters:
interface PermissionFilters extends BaseFilters {
  resource?: string;     // filter by resource (e.g., "properties")
}
```

### Decision: Redis Cache Invalidation on Permission/Role Mutations
Every `update()` and `delete()` call in `PermissionService` and `RoleService` must invalidate the Redis permission cache.

*Why:* The existing `auth-and-rbac` proposal uses a 5-minute TTL Redis cache for permission resolution. Without explicit invalidation, deleted or modified permissions remain effective for up to 5 minutes — a real security gap.

```typescript
// PermissionService.update/delete must call:
import { invalidatePermissionCache } from '@/lib/redis-permission-cache';

await invalidatePermissionCache(); // Invalidates for all orgs
```

If the cache invalidation utility does not yet exist, this proposal adds it as a dependency. If it exists, call it directly.

### Decision: Transaction Handling
Multi-step operations that span multiple database writes must use `tenantDb.$transaction()` or `globalDb.$transaction()`:

- **OrganizationService.createOrganization:** Already uses a transaction (create org + optional admin user + member). Preserved as-is.
- **RoleService.create:** Creating a role with initial permission assignments should use a transaction (create role → create role-permission entries).
- **PermissionService.delete:** Deleting a permission that is assigned to multiple roles should use a transaction (delete role-permission entries → delete permission).

*Why:* Ensures atomicity — partial failures don't leave the database in an inconsistent state.

### Decision: Shared Error→HTTP-Response Mapper
`lib/services/error-handler.ts` exports a `handleServiceError()` function that maps error types to standardized HTTP responses:

```typescript
// lib/services/error-handler.ts exports:
export function handleServiceError(error: unknown): Response {
  if (error instanceof ValidationError) return json({ error: error.message }, { status: 400 });
  if (error instanceof UnauthorizedError) return json({ error: error.message }, { status: 401 });
  if (error instanceof ForbiddenError) return json({ error: error.message }, { status: 403 });
  if (error instanceof NotFoundError) return json({ error: error.message }, { status: 404 });
  if (error instanceof ConflictError) return json({ error: error.message }, { status: 409 });
  // Fallback for unexpected errors
  logger.error('Unhandled service error', { error });
  return json({ error: 'Internal server error' }, { status: 500 });
}
```

*Why:* Prevents every refactored API route from reimplementing the same error-to-HTTP mapping logic.

### Decision: Singleton Pattern (Consistent with Existing)
Follow the existing `OrganizationService` pattern of exporting a singleton object.

*Why:* Consistent with the established codebase convention; avoids unnecessary class instantiation overhead in Node.js.

## Service Interface Specifications

### OrganizationService (Refactored)
**Model locality:** Global model, uses `globalDb`.

| Method | Platform Admin | Tenant Admin | MEMBER |
|--------|---------------|--------------|--------|
| `create(data, ctx)` | Any org (creates new) | Forbidden | Forbidden |
| `getById(id, ctx)` | Any org | Own org only | Forbidden |
| `list(filters, pagination, ctx)` | All orgs | Own org only | Forbidden |
| `update(id, data, ctx)` | Any org (name, slug, status) | Own org only (name, status; slug immutable after creation) | Forbidden |
| `delete(id, ctx)` | Any org (throws ConflictError if members exist; Platform org protected) | Forbidden | Forbidden |

### UserService
**Model locality:** Global model, uses `globalDb`. Tenant Admin access enforced via Member join table filtering.

| Method | Platform Admin | Tenant Admin | MEMBER |
|--------|---------------|--------------|--------|
| `create(data, ctx)` | Global (any org membership) | Create + add to own org only | Forbidden |
| `getById(id, ctx)` | Any user | Own org members only | Forbidden |
| `list(filters, pagination, ctx)` | All users | Own org members only (via Member join) | Forbidden |
| `update(id, data, ctx)` | Any user | Own org members only | Forbidden |
| `delete(id, ctx)` | Any user | Own org members only (removes member relationship first) | Forbidden |

### RoleService (Org-Scoped)
**Model locality:** Org-scoped model, uses `tenantDb`. All methods take explicit `targetOrgId`.

| Method | Platform Admin | Tenant Admin | MEMBER |
|--------|---------------|--------------|--------|
| `create(data, targetOrgId, ctx)` | Any org | Own org only (`targetOrgId === ctx.organizationId`) | Forbidden |
| `getById(id, targetOrgId, ctx)` | Any org | Own org only | Forbidden |
| `list(targetOrgId, filters, pagination, ctx)` | All orgs | Own org only | Forbidden |
| `update(id, data, targetOrgId, ctx)` | Any org | Own org only | Forbidden |
| `delete(id, targetOrgId, ctx)` | Any org (safety check: members assigned) | Own org only (safety check) | Forbidden |

### PermissionService (Global)
**Model locality:** Global model, uses `globalDb`. Redis cache invalidated on mutations.

| Method | Platform Admin | Tenant Admin | MEMBER |
|--------|---------------|--------------|--------|
| `create(data, ctx)` | Yes (global) | Forbidden | Forbidden |
| `getById(id, ctx)` | Yes | Read-only | Forbidden |
| `list(filters, pagination, ctx)` | Yes | Read-only | Forbidden |
| `update(id, data, ctx)` | Yes (global; invalidates Redis cache) | Forbidden | Forbidden |
| `delete(id, ctx)` | Yes (safety check; invalidates Redis cache) | Forbidden | Forbidden |

## Authorization Flow Diagram

```
API Route Request
       │
       ▼
┌─────────────────────┐
│ requireAuth()        │  ← Verify session is valid (existing guard)
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ requireSuperAdmin()  │  ← Verify user is Platform Admin (for /admin/* routes)
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Construct ServiceContext  ← userId, role, organizationId from session
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Service Method Call  │  ← Pass explicit targetOrgId for org-scoped models
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Service Authorization│  ← Check: Is requester authorized for this org/model?
│ (Option A)           │     PLATFORM_ADMIN → allow
└─────────┬───────────┘     TENANT_ADMIN → verify targetOrgId === ctx.organizationId
          │                     MEMBER → throw ForbiddenError (all denied)
          ▼
┌─────────────────────┐
│ Redis Cache Invalidation  ← For PermissionService/RoleService mutations
│ (if applicable)      │
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ DB Operation         │  ← Execute Prisma query with organizationId scoping
│ (globalDb or tenantDb) │  (defense-in-depth: Prisma Extension + RLS)
└─────────┬───────────┘
          │
          ▼
       Response
```

## File Structure

```
services/
├── organization-service.ts   ← Refactored: full CRUD + authorization
├── user-service.ts           ← New: full CRUD for User model (global, globalDb)
├── role-service.ts           ← New: full CRUD for Role model (org-scoped, tenantDb)
└── permission-service.ts     ← New: full CRUD for Permission model (global, globalDb)

lib/
└── services/
    ├── types.ts              ← New: shared interfaces (ServiceContext, errors, pagination)
    ├── base-service.ts       ← New: authorization helper functions (not a class)
    └── error-handler.ts      ← New: shared error→HTTP-response mapper

tests/
├── unit/
│   ├── organization-service.test.ts
│   ├── user-service.test.ts
│   ├── role-service.test.ts
│   └── permission-service.test.ts
├── integration/
│   ├── organization-service.integration.test.ts
│   ├── user-service.integration.test.ts
│   ├── role-service.integration.test.ts
│   └── permission-service.integration.test.ts
└── e2e/
    ├── platform-admin-flow.test.ts
    └── security-flow.test.ts
```
