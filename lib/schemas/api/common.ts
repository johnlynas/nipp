import { z } from 'zod';

/**
 * Shared building blocks for API documentation schemas
 * (lib/schemas/api/). These are consumed by scripts/generate-openapi.mjs via
 * zod-openapi — they document the API, they do NOT gate runtime validation.
 */

// ---------------------------------------------------------------------------
// Generic response shapes
// ---------------------------------------------------------------------------

export const errorResponse = z
  .object({ error: z.string() })
  .meta({ id: 'ErrorResponse' });

export const successResponse = z.object({ success: z.literal(true) }).meta({ id: 'SuccessResponse' });

/** { message: string } — most deletion/acknowledge confirmations. */
export const messageResponseSchema = z.object({ message: z.string() }).meta({ id: 'MessageResponse' });

// ---------------------------------------------------------------------------
// Pagination (mirrors lib/services/types.ts PaginatedResult)
// ---------------------------------------------------------------------------

const paginationMeta = z
  .object({
    page: z.number(),
    pageSize: z.number(),
    total: z.number(),
    totalPages: z.number(),
  })
  .meta({ id: 'Pagination' });

/** Generic paginated list envelope — instantiated per entity with a suffix. */
export function listEnvelope<T extends z.ZodType>(item: T, idSuffix: string) {
  return z
    .object({
      items: z.array(item),
      pagination: paginationMeta,
    })
    .meta({ id: `List${idSuffix}` });
}

/** Generic page-meta query (page/pageSize used by most list endpoints). */
export const pagingParams = z.object({
  page: z.string().optional().describe('Page number (default 1)'),
  pageSize: z.string().optional().describe('Items per page (default 20, max 100)'),
});

/** Free-text search query param shared by list endpoints. */
export const searchParam = z.string().optional().describe('Search term');

// ---------------------------------------------------------------------------
// Timestamps / IDs — Prisma DateTime renders as ISO-8601 in the JSON API.
// ---------------------------------------------------------------------------

export const ts = z.string().meta({ description: 'ISO-8601 timestamp' });

export function idField(desc: string) {
  return z.string().meta({ description: desc });
}

// ---------------------------------------------------------------------------
// Domain enums (mirror prisma/schema.prisma + route-level literals)
// ---------------------------------------------------------------------------

export const orgStatus = z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'ARCHIVED']).meta({ id: 'OrgStatus' });

export const notificationPriority = z.enum(['INFO', 'WARNING', 'ERROR', 'CRITICAL', 'CALENDAR', 'JOB']).meta({
  id: 'NotificationPriority',
});

export const notificationScope = z.enum(['GLOBAL', 'ORG']).meta({ id: 'NotificationScope' });

export const notificationStatus = z.enum(['SENT', 'FAILED']).meta({ id: 'NotificationStatus' });

export const calendarEventType = z
  .enum(['VIEWING', 'INSPECTION', 'MAINTENANCE', 'LEASE_SIGNING', 'LEASE_RENEWAL', 'KEY_EXCHANGE', 'OTHER'])
  .meta({ id: 'CalendarEventType' });

/** JobExecution.status — SUCCEEDED | FAILED | CANCELLED (+ PENDING/RUNNING states). */
export const jobRunStatus = z.enum(['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED']).meta({
  id: 'JobRunStatus',
});
