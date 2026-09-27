import { z } from 'zod';
import * as M from './models';
import * as R from './requests';
import { errorResponse, successResponse } from './common';

/**
 * Per-route request/response registry for API documentation.
 *
 * Keyed by `"METHOD /path"` (OpenAPI path form: `{param}` for [param]/:param).
 * Consumed by scripts/generate-openapi.mjs and folded into the generated spec
 * via zod-openapi — these schemas document the API, they are NOT used for
 * runtime validation.
 *
 * Conventions:
 *  - E            — the standard { error: string } body for failure statuses.
 *  - msg(text)    — { message: string } acknowledgement (most deletes).
 *  - runResult    — job trigger/dry-run 202 payloads ({ result } / jobExecution).
 *  - Entry omitted  — endpoint intentionally left at the spec's default response
 *                    (e.g. the BetterAuth catch-all, whose responses vary by
 *                    sub-path and are modelled upstream).
 */

const E = errorResponse;

function msg(text: string) {
  return z.object({ message: z.literal(text) }).meta({ id: `Ack:${text}` });
}

/** POST job trigger/dry-run — scheduled execution descriptor. */
const runResult = M.jobExecution;

export type ApiEntry = {
  parameters?: Record<string, z.ZodType>;
  requestBody?: z.ZodType;
  responses: Record<string, z.ZodType | undefined>;
};

export const registry: Record<string, ApiEntry> = {
  // ---------------------------------------------------------------------------
  // Health / cache metrics / CSP
  // ---------------------------------------------------------------------------
  'GET /api/health': {
    responses: { '200': M.healthResponse, '503': M.healthResponse },
  },
  'GET /api/cache/metrics': {
    responses: { '200': M.cacheMetricsDetailResponse, '500': E },
  },
  'POST /api/csp-report': {
    requestBody: R.cspViolationReportBody,
    // Deliberate 204 No Content (spec requires it — see route header).
    responses: {} as Record<string, z.ZodType | undefined>,
  },

  // ---------------------------------------------------------------------------
  // Auth surface
  // ---------------------------------------------------------------------------
  'GET /api/auth/me': {
    responses: { '200': M.sessionUserResponse, '401': E },
  },
  'GET /api/auth/permissions': {
    responses: { '200': M.permissionContextResponse, '401': E, '500': E, '503': E },
  },
  'GET /api/auth/user-permissions': {
    responses: {
      // Resolved permission keys; ['*'] for super admin, [] when none.
      '200': z.array(z.string()).describe("Resolved permission keys; ['*'] for super admin, [] when none"),
    },
  },

  // ---------------------------------------------------------------------------
  // Notifications (admin) + SSE stream
  // ---------------------------------------------------------------------------
  'GET /api/admin/notifications': {
    responses: {
      '200': z
        .object({
          notifications: z.array(M.notificationAdmin),
          pagination: M.paginatedJobs.shape.pagination,
          counts: z.object({
            totalCount: z.number(),
            acknowledgedCount: z.number(),
            notAcknowledgedCount: z.number(),
            infoCount: z.number(),
            warningCount: z.number(),
            errorCount: z.number(),
            criticalCount: z.number(),
            calendarCount: z.number(),
            jobCount: z.number(),
          }),
        })
        .meta({ id: 'AdminNotificationsList' }),
      '400': E,
      '429': E,
      '500': E,
    },
  },
  'POST /api/admin/notifications': {
    requestBody: R.sendNotificationBody,
    responses: { '200': successResponse, '400': E, '429': E, '500': E },
  },
  'PATCH /api/admin/notifications': {
    responses: {
      '200': z.object({ success: z.literal(true), acknowledged: z.boolean() }).meta({ id: 'NotificationAck' }),
      '400': E,
      '404': E,
      '429': E,
      '500': E,
    },
  },
  'DELETE /api/admin/notifications': {
    responses: { '200': successResponse, '400': E, '404': E, '429': E, '500': E },
  },

  // ---------------------------------------------------------------------------
  // Organizations (admin)
  // ---------------------------------------------------------------------------
  'GET /api/admin/organizations': {
    responses: { '200': M.paginatedOrganizations, '400': E, '429': E, '500': E },
  },
  'POST /api/admin/organizations': {
    requestBody: R.createOrganizationBody,
    responses: { '201': M.singleOrganization, '400': E, '429': E, '500': E },
  },

  // ---------------------------------------------------------------------------
  // Org detail (admin)
  // ---------------------------------------------------------------------------
  'GET /api/admin/organizations/{orgId}': {
    responses: { '200': M.organizationDetail, '400': E, '404': E, '429': E, '503': E },
  },
};
