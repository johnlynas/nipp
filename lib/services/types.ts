/**
 * Shared types for the data model service layer.
 *
 * Defines ServiceContext, typed error classes, pagination interfaces,
 * and filter types used by all CRUD services.
 */

// ---------------------------------------------------------------------------
// ServiceContext — passed to every service method
// ---------------------------------------------------------------------------

/**
 * Authorization context constructed by the calling route.
 *
 * - `userId`: The authenticated user's ID (always present for guarded routes).
 * - `role`: The user's highest role across all their memberships.
 *   - `'PLATFORM_ADMIN'` — member of the Platform Organization (super admin).
 *   - `'TENANT_ADMIN'` — admin role in one or more tenant organizations.
 *   - `'MEMBER'` — regular member (no admin privileges).
 * - `organizationId`: The org the user is acting within, set by the route.
 *   For Platform Admins this is typically undefined or the Platform org ID.
 *
 * Multi-org resolution: a user may hold memberships in multiple orgs;
 * `ctx.organizationId` represents the active session context (the org used
 * by the calling route). The route that calls a service method must always
 * pass an explicit `targetOrgId` for org-scoped operations.
 */
export interface ServiceContext {
  userId: string;
  role: 'PLATFORM_ADMIN' | 'TENANT_ADMIN' | 'MEMBER';
  organizationId?: string;
}

// ---------------------------------------------------------------------------
// Typed Error Classes
// ---------------------------------------------------------------------------

/** Validation failures (e.g., missing required fields, invalid pagination params). */
export class ValidationError extends Error {
  readonly code = 'VALIDATION_ERROR' as const;
  readonly status = 400 as const;

  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Programming error — missing ctx.userId or similar (should never reach user). */
export class UnauthorizedError extends Error {
  readonly code = 'UNAUTHORIZED' as const;
  readonly status = 401 as const;

  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/** Authorization denied — user lacks permission for this action/resource. */
export class ForbiddenError extends Error {
  readonly code = 'FORBIDDEN' as const;
  readonly status = 403 as const;

  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/** Resource not found. */
export class NotFoundError extends Error {
  readonly code = 'NOT_FOUND' as const;
  readonly status = 404 as const;

  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** Conflict — e.g., unique constraint violation (Prisma P2002), resource in use. */
export class ConflictError extends Error {
  readonly code = 'CONFLICT' as const;
  readonly status = 409 as const;

  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export interface PaginatedResult<T> {
  items: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface PaginationInput {
  page?: number;       // default: 1, min: 1
  pageSize?: number;   // default: 20, max: 100 (prevents abuse)
}

/** Normalize pagination input with bounds enforcement. */
export function normalizePagination(input: PaginationInput): { page: number; pageSize: number } {
  let page = input.page ?? 1;
  let pageSize = input.pageSize ?? 20;

  if (page < 1) {
    page = 1;
  }
  if (pageSize > 100) {
    pageSize = 100;
  }
  if (pageSize < 1 || !Number.isFinite(pageSize)) {
    throw new ValidationError('Invalid pageSize: must be a positive number (max 100)');
  }

  return { page, pageSize };
}

// ---------------------------------------------------------------------------
// Filter Types
// ---------------------------------------------------------------------------

/** Common filter fields available across services where applicable. */
export interface BaseFilters {
  search?: string;
}

/** Filters for Organization list queries. */
export interface OrganizationFilters extends BaseFilters {
  status?: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
}

/** Filters for User list queries (Tenant Admin scope: only members of their org). */
export interface UserFilters extends BaseFilters {
  role?: string; // filter by member role within the org
  organizationId?: string; // filter users belonging to a specific organization (Platform Admin only)
  teamId?: string; // filter users belonging to a specific team (Platform Admin only)
  status?: 'active' | 'banned'; // filter by ban status (Platform Admin only)
}

/** Filters for Role list queries. */
export interface RoleFilters extends BaseFilters {
  isDefault?: boolean; // filter by default vs custom roles
}

/** Filters for Permission list queries. */
export interface PermissionFilters extends BaseFilters {
  resource?: string; // filter by resource (e.g., "properties")
}
