import { z } from 'zod';
import * as M from './models';
import * as R from './requests';
import { errorResponse, messageResponseSchema, successResponse } from './common';

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
 *  - Entry omitted  — endpoint intentionally left at the spec's default response
 *                    (e.g. the BetterAuth catch-all, whose responses vary by
 *                    sub-path and are modelled upstream).
 */

const E = errorResponse;

function msg(text: string) {
  return z.object({ message: z.literal(text) }).meta({ id: `Ack:${text}` });
}

/** DELETE /api/roles/{roleId} — 400 body when the role still has assigned members. */
const roleDeleteConflictErr = z
  .object({
    error: z.string().describe('e.g. "Cannot delete role with 3 assigned member(s)"'),
    memberCount: z.number(),
  })
  .meta({ id: 'RoleDeleteConflictError' });

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
    responses: { '200': M.cacheMetricsResponse, '500': E },
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
  // Jobs (platform, super admin) + audit / system logs
  // ---------------------------------------------------------------------------
  'GET /api/admin/jobs': {
    parameters: {
      enabled: z.string().optional().describe("Filter by enabled flag ('true' | 'false')"),
      approved: z.string().optional().describe("Filter by approval gate ('true' | 'false')"),
      limit: z.string().optional().describe('Max rows to return (1–500)'),
    },
    responses: { '200': M.jobDefinitionList, '404': E, '503': E },
  },
  'POST /api/admin/jobs': {
    requestBody: R.createJobBody,
    responses: { '201': M.singleJob, '400': E, '429': E, '500': E },
  },
  'GET /api/admin/jobs/{jobId}': {
    responses: { '200': M.singleJob, '404': E, '503': E },
  },
  'PATCH /api/admin/jobs/{jobId}': {
    requestBody: R.updateJobBody,
    responses: { '200': M.singleJob, '404': E, '429': E, '503': E },
  },
  'DELETE /api/admin/jobs/{jobId}': {
    responses: { '200': M.jobDisposedResponse, '404': E, '429': E, '503': E },
  },
  'POST /api/admin/jobs/{jobId}/trigger': {
    requestBody: R.jobRunBody,
    responses: { '202': M.runJobResponse, '403': E, '404': E, '429': E, '503': E },
  },
  'POST /api/admin/jobs/{jobId}/dry-run': {
    requestBody: R.jobRunBody,
    responses: { '202': M.runJobResponse, '400': E, '403': E, '404': E, '429': E, '503': E },
  },
  'POST /api/admin/jobs/{jobId}/approvals': {
    requestBody: R.jobControlActionBody,
    responses: { '200': M.jobApprovalResponse, '403': E, '404': E, '429': E, '503': E },
  },
  'GET /api/admin/jobs/{jobId}/history': {
    parameters: {
      limit: z.string().optional().describe('Max executions to return (default 50)'),
      status: z.enum(['SUCCEEDED', 'FAILED', 'CANCELLED']).optional(),
    },
    responses: { '200': M.jobExecutionList, '403': E, '404': E, '503': E },
  },
  'GET /api/admin/audit-logs': {
    parameters: {
      page: z.string().optional().describe('Page number (default 1)'),
      pageSize: z.string().optional().describe('Rows per page (default 50)'),
      resourceType: z.string().optional().describe('Filter by audited resource type'),
    },
    responses: { '200': M.auditLogPage, '429': E, '500': E },
  },
  'GET /api/admin/system-logs': {
    responses: { '200': M.systemLogList, '401': E, '500': E },
  },
  'GET /api/admin/cache/metrics': {
    parameters: { action: z.literal('reset').optional().describe('Pass ?action=reset to zero the counters') },
    responses: { '200': M.cacheMetricsResponse, '429': E, '500': E },
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
  // Org members (super admin, cross-tenant)
  // ---------------------------------------------------------------------------
  'GET /api/admin/organizations/{orgId}/members': {
    responses: { '200': M.adminOrgMemberList, '404': E, '503': E },
  },
  'POST /api/admin/organizations/{orgId}/members': {
    requestBody: R.addMemberBody,
    responses: { '201': M.addedMember, '400': E, '404': E, '409': E, '429': E, '503': E },
  },
  'PATCH /api/admin/organizations/{orgId}/members/{memberId}': {
    requestBody: R.updateMemberRoleBody,
    responses: { '200': M.updatedMember, '400': E, '404': E, '503': E },
  },
  'DELETE /api/admin/organizations/{orgId}/members/{memberId}': {
    responses: {
      '200': msg('Member removed successfully'),
      '400': E,
      '404': E,
      '429': E,
      '503': E,
    },
  },

  // ---------------------------------------------------------------------------
  // Org tenant roles (super admin)
  // ---------------------------------------------------------------------------
  'GET /api/admin/organizations/{orgId}/roles': {
    responses: { '200': M.orgRolesList, '404': E, '503': E },
  },
  'POST /api/admin/organizations/{orgId}/roles': {
    requestBody: R.orgCreateRoleBody,
    responses: { '201': M.createdRole, '400': E, '403': E, '404': E, '409': E, '429': E, '500': E, '503': E },
  },
  'PATCH /api/admin/organizations/{orgId}/roles/{roleId}': {
    requestBody: R.orgUpdateRoleBody,
    responses: { '200': M.updatedRole, '403': E, '404': E, '429': E, '500': E, '503': E },
  },
  'DELETE /api/admin/organizations/{orgId}/roles/{roleId}': {
    responses: {
      // 400 when the role still has assigned members (reassign/remove first).
      '200': msg('Role deleted successfully'),
      '400': E,
      '404': E,
      '429': E,
      '503': E,
    },
  },

  // ---------------------------------------------------------------------------
  // Org permissions matrix (super admin)
  // ---------------------------------------------------------------------------
  'GET /api/admin/organizations/{orgId}/permissions': {
    responses: { '200': M.permissionsMatrix, '404': E, '503': E },
  },
  'PATCH /api/admin/organizations/{orgId}/permissions': {
    requestBody: R.batchAssignPermissionsBody,
    responses: { '200': M.permissionsUpdateResponse, '400': E, '404': E, '429': E, '503': E },
  },

  // ---------------------------------------------------------------------------
  // Org settings / status (super admin)
  // ---------------------------------------------------------------------------
  'PATCH /api/admin/organizations/{orgId}/settings': {
    requestBody: R.orgUpdateOrganizationBody,
    responses: { '200': M.organizationUpdated, '400': E, '404': E, '409': E, '429': E, '503': E },
  },
  // Note: the 400 body on a rejected transition carries extra fields (current, allowedTransitions).
  'PATCH /api/admin/organizations/{id}/status': {
    requestBody: R.changeOrganizationStatusBody,
    responses: { '200': M.orgStatusChangeResponse, '400': E, '404': E, '429': E, '500': E },
  },

  // ---------------------------------------------------------------------------
  // Org switcher list + prefix search (super admin)
  // ---------------------------------------------------------------------------
  'GET /api/admin/organizations/list': {
    responses: { '200': M.organizationSwitcherList, '429': E, '500': E },
  },
  'GET /api/admin/organizations/search': {
    parameters: {
      q: z.string().min(1).describe('Name prefix match, case-insensitive (max 100 chars)'),
      limit: z.string().optional().describe(`Rows to return (default 10, max 50)`),
    },
    responses: { '200': M.orgSearchResults, '400': E, '429': E, '503': E },
  },

  // ---------------------------------------------------------------------------
  // Org detail (admin)
  // ---------------------------------------------------------------------------
  'GET /api/admin/organizations/{orgId}': {
    responses: { '200': M.organizationDetail, '400': E, '404': E, '429': E, '503': E },
  },
  'PATCH /api/admin/organizations/{orgId}': {
    requestBody: R.orgUpdateOrganizationBody,
    responses: { '200': M.organizationUpdated, '400': E, '404': E, '409': E, '429': E, '503': E },
  },
  // PENDING orgs are hard-deleted; ACTIVE/SUSPENDED move to ARCHIVED; already-ARCHIVED → 400.
  'DELETE /api/admin/organizations/{orgId}': {
    responses: { '200': messageResponseSchema, '400': E, '404': E, '429': E, '503': E },
  },

  // ---------------------------------------------------------------------------
  // Platform role catalog (super admin)
  // ---------------------------------------------------------------------------
  'GET /api/admin/roles': {
    parameters: {
      page: z.string().optional().describe('Page number (default 1)'),
      pageSize: z.string().optional().describe('Rows per page (default 8)'),
      search: z.string().optional().describe('Name filter, case-insensitive substring'),
      isDefault: z.string().optional().describe("Filter by bootstrapped flag ('true' | 'false')"),
      orgId: z.string().optional().describe('Scope to one organization'),
    },
    responses: { '200': M.adminPlatformRolesList, '401': E, '503': E, '500': E },
  },
  'POST /api/admin/roles': {
    requestBody: R.createRoleBody,
    // organizationId is optional in the body — target org falls back to the platform org.
    responses: { '201': M.singleRole, '400': E, '403': E, '409': E, '429': E, '503': E, '500': E },
  },
  'GET /api/admin/roles/{roleId}': {
    responses: { '200': M.singleRole, '400': E, '403': E, '404': E, '503': E, '500': E },
  },
  'PATCH /api/admin/roles/{roleId}': {
    requestBody: R.updateRoleBody,
    responses: { '200': M.singleRole, '400': E, '403': E, '404': E, '409': E, '429': E, '503': E, '500': E },
  },
  // 409 while the role still has assigned members (remove them first).
  'DELETE /api/admin/roles/{roleId}': {
    responses: { '200': msg('Role deleted'), '400': E, '404': E, '409': E, '429': E, '503': E, '500': E },
  },

  // ---------------------------------------------------------------------------
  // Permission catalog (super admin)
  // ---------------------------------------------------------------------------
  'GET /api/admin/permissions': {
    parameters: {
      page: z.string().optional().describe('Page number (default 1)'),
      pageSize: z.string().optional().describe('Rows per page (default 8)'),
      resource: z.string().optional().describe('Filter by resource segment, e.g. "properties"'),
      search: z.string().optional().describe('Key/name filter'),
    },
    responses: { '200': M.paginatedPermissions, '401': E, '503': E, '500': E },
  },
  'POST /api/admin/permissions': {
    requestBody: R.createPermissionBody,
    responses: { '201': M.singlePermission, '400': E, '409': E, '429': E, '503': E, '500': E },
  },
  'GET /api/admin/permissions/{id}': {
    responses: { '200': M.singlePermission, '400': E, '404': E, '503': E, '500': E },
  },
  'PATCH /api/admin/permissions/{id}': {
    requestBody: R.updatePermissionBody,
    responses: { '200': M.singlePermission, '400': E, '404': E, '409': E, '429': E, '503': E, '500': E },
  },
  // PermissionService.delete throws ConflictError for in-use / isDefault permissions;
  // the route maps it to 409 (the null-refusal quirk was fixed).
  'DELETE /api/admin/permissions/{id}': {
    responses: { '200': msg('Permission deleted'), '400': E, '404': E, '409': E, '429': E, '503': E, '500': E },
  },
  'GET /api/admin/permissions/resources': {
    responses: { '200': M.permissionResourcesList, '401': E, '429': E, '503': E, '500': E },
  },
  'GET /api/admin/permissions/search': {
    parameters: {
      q: z.string().min(1).describe('Key prefix match, case-insensitive (max 100 chars)'),
      limit: z.string().optional().describe('Rows to return (default 10, max 50; results cached 30s)'),
    },
    responses: { '200': M.searchPermissionsResults, '400': E, '401': E, '429': E, '500': E },
  },

  // ---------------------------------------------------------------------------
  // Roles (top-level tenant RBAC assignment surface)
  // ---------------------------------------------------------------------------
  'POST /api/roles': {
    requestBody: R.createTopLevelRoleBody,
    responses: { '201': M.singleRole, '400': E, '401': E, '403': E, '409': E, '429': E, '500': E },
  },
  'GET /api/roles/search': {
    parameters: {
      q: z.string().min(1).describe('Name prefix match, case-insensitive (max 100 chars)'),
      organizationId: z.string().describe('Organization to search within (required)'),
      limit: z.string().optional().describe('Rows to return (default 10, max 50; results cached 30s)'),
    },
    responses: { '200': M.searchRolesResults, '400': E, '401': E, '403': E, '500': E },
  },
  'GET /api/roles/permissions': {
    // Compact catalog select (key/resource/action/description), sorted by resource; cached 60s.
    responses: { '200': M.rolePermissionsCatalog, '401': E },
  },
  'POST /api/roles/{roleId}/members': {
    requestBody: R.addRoleMemberBody,
    // Sets the member's role string to this custom role name; target user must be an org member.
    responses: { '200': successResponse, '400': E, '401': E, '403': E, '404': E, '429': E, '500': E },
  },
  'POST /api/roles/{roleId}/permissions': {
    requestBody: R.assignRolePermissionsBody,
    // Upserts each key; all keys must exist in the catalog (400 listing invalid ones).
    responses: { '200': successResponse, '400': E, '401': E, '403': E, '404': E, '429': E, '500': E },
  },
  // Default roles → 403; roles with assigned members → 400 carrying { memberCount }.
  'DELETE /api/roles/{roleId}': {
    responses: { '200': M.roleDeletedResponse, '400': roleDeleteConflictErr, '401': E, '403': E, '404': E, '429': E, '500': E },
  },

  // ---------------------------------------------------------------------------
  // Users (admin, super admin catalog via UserService)
  // ---------------------------------------------------------------------------
  'GET /api/admin/users': {
    parameters: {
      page: z.string().optional().describe('Page number (default 1)'),
      pageSize: z.string().optional().describe('Rows per page (default 8)'),
      search: z.string().optional().describe('Name or email substring, case-insensitive'),
      role: z.string().optional().describe("Filter by membership role, e.g. 'admin'"),
      organizationId: z.string().optional().describe('Scope to members of one organization'),
    },
    // Rows are newest-first; each carries member count + first membership + team memberships.
    responses: { '200': M.paginatedUsers, '401': E, '503': E, '500': E },
  },
  'POST /api/admin/users': {
    requestBody: R.createUserBody,
    // With a password, a BetterAuth credential account is created alongside the user.
    responses: { '201': M.singleUser, '400': E, '401': E, '409': E, '429': E, '503': E, '500': E },
  },
  'GET /api/admin/users/{userId}': {
    responses: { '200': M.singleUser, '400': E, '401': E, '403': E, '404': E, '503': E, '500': E },
  },
  'PATCH /api/admin/users/{userId}': {
    requestBody: R.updateUserBody,
    // Email change rechecks global uniqueness (409 on clash).
    responses: { '200': M.singleUser, '400': E, '401': E, '403': E, '404': E, '409': E, '429': E, '503': E, '500': E },
  },
  // Hard delete — Prisma cascades (memberships, team memberships, accounts).
  'DELETE /api/admin/users/{userId}': {
    responses: { '200': msg('User deleted'), '400': E, '401': E, '403': E, '404': E, '429': E, '503': E, '500': E },
  },
  'GET /api/admin/users/search': {
    parameters: {
      q: z.string().min(1).describe('Name or email prefix, case-insensitive (max 100 chars)'),
      limit: z.string().optional().describe('Rows to return (default 10, max 50; uncached — PII)'),
    },
    responses: { '200': M.userSearchResults, '400': E, '401': E, '429': E, '503': E, '500': E },
  },

  // ---------------------------------------------------------------------------
  // Dashboard orgs (super admin) + client error logger
  // Note: dashboard routes return BARE Prisma rows — no { organization } envelope.
  // ---------------------------------------------------------------------------
  'GET /api/dashboard/admin/organizations': {
    parameters: {
      page: z.string().optional().describe('Page number (default 1)'),
      pageSize: z.string().optional().describe('Rows per page (default 20)'),
      status: M.organization.shape.status.optional().describe('Filter by lifecycle status'),
      search: z.string().optional().describe('Name substring, case-insensitive'),
    },
    // Rows are newest-first; response also carries globalTotal + statusCounts for stat cards.
    responses: { '200': M.paginatedOrganizations, '401': E, '500': E },
  },
  'POST /api/dashboard/admin/organizations': {
    requestBody: R.dashboardCreateOrganizationBody,
    // Bootstraps a default Members team + Main Calendar alongside the org row.
    responses: { '201': M.organization, '400': E, '401': E, '409': E, '429': E, '500': E },
  },
  'GET /api/dashboard/admin/organizations/{id}': {
    responses: { '200': M.organization, '401': E, '403': E, '404': E, '500': E },
  },
  'PATCH /api/dashboard/admin/organizations/{id}': {
    requestBody: R.updateOrganizationBody,
    responses: { '200': M.organization, '400': E, '401': E, '403': E, '404': E, '429': E, '500': E },
  },
  // Suspend/archive ban all member users + invalidate sessions; SUSPENDED→ACTIVE unbans. SSE push follows.
  'PATCH /api/dashboard/admin/organizations/{id}/status': {
    requestBody: R.changeOrganizationStatusBody,
    responses: { '200': M.organization, '400': E, '401': E, '403': E, '404': E, '429': E, '500': E },
  },
  'POST /api/dashboard/admin/errors': {
    requestBody: R.logErrorBody,
    // Fire-and-forget client error sink — logs via pino, returns only a success flag.
    responses: { '200': successResponse, '401': E, '429': E, '500': E },
  },

  // ---------------------------------------------------------------------------
  // Dashboard roles (super admin) — RoleService, org via ?organizationId (or body for POST)
  // Note: like the other dashboard routes these return BARE rows / bare arrays.
  // Quirk: the [id]-subroute catch blocks map almost every service error (incl.
  // name clashes and NotFound on permission subroutes) to a generic 500 — only
  // the explicit 'Role not found' branch is 404 and delete-conflict is 409.
  // ---------------------------------------------------------------------------
  'GET /api/dashboard/admin/roles': {
    parameters: {
      page: z.string().optional().describe('Page number (default 1)'),
      pageSize: z.string().optional().describe('Rows per page (default 20)'),
      organizationId: z.string().optional().describe('Scope to one org; omit for the cross-org merge'),
      search: z.string().optional().describe('Name filter, case-insensitive substring'),
      isDefault: z.string().optional().describe("Filter by bootstrapped flag ('true' | 'false')"),
    },
    // counts (default/custom/in-use) always reflect the full dataset, not the filtered page.
    responses: { '200': M.dashboardAdminRolesList, '401': E, '500': E },
  },
  'POST /api/dashboard/admin/roles': {
    requestBody: R.dashboardCreateRoleBody,
    // Bare role row — no envelope. Missing organizationId → 400; name clash → 409.
    responses: { '201': M.role, '400': E, '401': E, '409': E, '429': E, '500': E },
  },
  'GET /api/dashboard/admin/roles/{id}': {
    parameters: { organizationId: z.string().describe('Target org (query param, required)') },
    // Role row with nested permissions + member count projection.
    responses: { '200': M.roleDetail, '400': E, '401': E, '404': E, '500': E },
  },
  'PATCH /api/dashboard/admin/roles/{id}': {
    parameters: { organizationId: z.string().describe('Target org (query param, required)') },
    requestBody: R.updateDashboardRoleBody,
    // Bare updated role row; Redis permission cache invalidated on change.
    // Name clash surfaces as 500 here (ConflictError is not mapped by the handler).
    responses: { '200': M.role, '400': E, '401': E, '404': E, '429': E, '500': E },
  },
  // 409 while the role still has assigned members (remove them first).
  'DELETE /api/dashboard/admin/roles/{id}': {
    parameters: { organizationId: z.string().describe('Target org (query param, required)') },
    responses: { '200': successResponse, '400': E, '401': E, '404': E, '409': E, '429': E, '500': E },
  },
  'GET /api/dashboard/admin/roles/{id}/members': {
    parameters: { organizationId: z.string().describe('Target org (query param, required)') },
    // Bare ARRAY of member summaries (not wrapped in an object).
    responses: { '200': z.array(M.roleMemberSummary), '400': E, '401': E, '500': E },
  },
  'GET /api/dashboard/admin/roles/{id}/permissions': {
    parameters: { organizationId: z.string().describe('Target org (query param, required)') },
    // Bare ARRAY of full permission rows (role.permissions projected to .permission).
    responses: { '200': z.array(M.permission), '400': E, '401': E, '500': E },
  },
  'POST /api/dashboard/admin/roles/{id}/permissions': {
    parameters: { organizationId: z.string().describe('Target org (query param, required)') },
    requestBody: R.assignRolePermissionBody,
    // Quirk: role/permission NotFound and duplicate assignment all land in the
    // handler's catch → generic 500 (no 404/409 mapping on this subroute).
    responses: { '201': successResponse, '400': E, '401': E, '429': E, '500': E },
  },
  'DELETE /api/dashboard/admin/roles/{id}/permissions': {
    parameters: { organizationId: z.string().describe('Target org (query param, required)') },
    // Body carries permissionId; revoke is a deleteMany (no error when unassigned).
    responses: { '200': successResponse, '400': E, '401': E, '429': E, '500': E },
  },

  // ---------------------------------------------------------------------------
  // Dashboard permission catalog (platform-admin, global — no org scoping)
  // ---------------------------------------------------------------------------
  'GET /api/dashboard/admin/permissions': {
    parameters: {
      page: z.string().optional().describe('Page number (default 1)'),
      pageSize: z.string().optional().describe('Rows per page (default 20)'),
      search: z.string().optional().describe('Key filter, case-insensitive substring'),
      resource: z.string().optional().describe('Filter by resource segment, e.g. "properties"'),
      isDefault: z.string().optional().describe("Filter by bootstrapped flag ('true' | 'false')"),
    },
    responses: { '200': M.paginatedPermissions, '401': E, '500': E },
  },
  'POST /api/dashboard/admin/permissions': {
    requestBody: R.createPermissionBody,
    // Bare permission row — no envelope; key/resource/action all required (400).
    responses: { '201': M.permission, '400': E, '401': E, '409': E, '429': E, '500': E },
  },
  'GET /api/dashboard/admin/permissions/{id}': {
    responses: { '200': M.permission, '401': E, '404': E, '500': E },
  },
  'PATCH /api/dashboard/admin/permissions/{id}': {
    requestBody: R.updatePermissionBody,
    // Key clash is correctly mapped to 409 here (unlike the dashboard roles PATCH).
    responses: { '200': M.permission, '401': E, '404': E, '409': E, '429': E, '500': E },
  },
  // PermissionService.delete throws ConflictError for in-use / isDefault permissions — mapped here to 409.
  'DELETE /api/dashboard/admin/permissions/{id}': {
    responses: { '200': successResponse, '401': E, '404': E, '409': E, '500': E },
  },

  // ---------------------------------------------------------------------------
  // Dashboard resource catalog (platform-admin, global)
  // ---------------------------------------------------------------------------
  'GET /api/dashboard/admin/resources': {
    parameters: {
      page: z.string().optional().describe('Page number (default 1)'),
      pageSize: z.string().optional().describe('Rows per page (default 20)'),
      search: z.string().optional().describe('Name filter, case-insensitive substring'),
    },
    // Rows are alphabetical; each carries its resourceRole junction rows with the full role.
    responses: { '200': M.paginatedResourcesWithRoles, '401': E, '500': E },
  },
  'POST /api/dashboard/admin/resources': {
    requestBody: R.createResourceBody,
    // Bare resource row (role junctions not echoed back); name clash → 409.
    responses: { '201': M.resourceRow, '400': E, '401': E, '409': E, '429': E, '500': E },
  },
  'GET /api/dashboard/admin/resources/{id}': {
    // Bare resource row with resourceRoles (role included).
    responses: { '200': M.resourceWithRoles, '401': E, '404': E, '500': E },
  },
  'PATCH /api/dashboard/admin/resources/{id}': {
    requestBody: R.updateResourceBody,
    // Bare updated row WITHOUT the junction include; roleIds (when present) fully replaces assignments.
    responses: { '200': M.resourceRow, '401': E, '404': E, '409': E, '429': E, '500': E },
  },
  // 409 while roles are still assigned to the resource.
  'DELETE /api/dashboard/admin/resources/{id}': {
    responses: { '200': successResponse, '401': E, '404': E, '409': E, '500': E },
  },
  // Feeds the permissions page's "Filter by Resource" dropdown.
  'GET /api/dashboard/admin/resources/names': {
    responses: {
      '200': z.object({ names: z.array(z.string()).describe('All resource names, sorted ascending') }).meta({ id: 'ResourceNamesList' }),
      '401': E,
      '500': E,
    },
  },

  // ---------------------------------------------------------------------------
  // Dashboard scripts (platform job definitions — same JobSchedulerService as /api/admin/jobs)
  // Catch blocks map service classes: NotFound → 404, Forbidden → 403,
  // Conflict → 409, Validation → 400 (previously most of these fell to generic 500).
  // Note: trigger/dry-run return the BARE RunResult (no { result } wrapper) and HTTP 200.
  // ---------------------------------------------------------------------------
  'GET /api/dashboard/admin/scripts': {
    parameters: {
      page: z.string().optional().describe('Page number (default 1)'),
      pageSize: z.string().optional().describe('Rows per page (default 8, max 100)'),
      enabled: z.string().optional().describe("Filter by enabled flag ('true' | 'false')"),
      approved: z.string().optional().describe("Filter by approval gate ('true' | 'false')"),
      lastRunStatus: z.string().optional().describe('Filter by last execution status, e.g. "SUCCEEDED"'),
      search: z.string().optional().describe('Name or description substring, case-insensitive'),
    },
    // Rows newest-first; stat-card counts always from the full dataset, independent of filters.
    responses: { '200': M.dashboardScriptsList, '401': E, '500': E },
  },
  'POST /api/dashboard/admin/scripts': {
    requestBody: R.createJobBody,
    // Bare job row (no envelope); new jobs start approved:false — must be approved before enabling/triggering.
    // Name clash → 409; missing name / bad schedule / invalid operator code → 400.
    responses: { '201': M.jobDefinition, '400': E, '401': E, '409': E, '429': E, '500': E },
  },
  'GET /api/dashboard/admin/scripts/{id}': {
    // Job definition + last 50 executions (newest first).
    responses: { '200': M.scriptDetailResponse, '401': E, '404': E, '500': E },
  },
  'PATCH /api/dashboard/admin/scripts/{id}': {
    requestBody: R.updateJobBody,
    // Bare updated job row; enabling (enabled:true) on an unapproved job → 403; bad schedule/name/code → 400.
    responses: { '200': M.jobDefinition, '400': E, '401': E, '403': E, '404': E, '429': E, '500': E },
  },
  'DELETE /api/dashboard/admin/scripts/{id}': {
    responses: { '200': successResponse, '401': E, '404': E, '429': E, '500': E },
  },
  'POST /api/dashboard/admin/scripts/{id}/trigger': {
    requestBody: R.jobRunBody,
    // Forbidden covers both disabled and unapproved jobs.
    responses: { '200': M.runJobResult, '401': E, '403': E, '404': E, '429': E, '500': E },
  },
  'POST /api/dashboard/admin/scripts/{id}/dry-run': {
    requestBody: R.jobRunBody,
    // Dry-run only applies to jobs with operator-authored code — missing code → 400.
    responses: { '200': M.runJobResult, '400': E, '401': E, '404': E, '429': E, '500': E },
  },

  // ---------------------------------------------------------------------------
  // Dashboard teams (TeamService) — cross-org listing; org is a query/body field
  // Catch blocks map service classes: NotFound → 404, Forbidden → 403,
  // Conflict → 409, Validation → 400 (previously most of these fell to generic 500).
  // ---------------------------------------------------------------------------
  'GET /api/dashboard/admin/teams': {
    parameters: {
      page: z.string().optional().describe('Page number (default 1)'),
      pageSize: z.string().optional().describe('Rows per page (default 20)'),
      organizationId: z.string().optional().describe('Scope to one org; omit for the cross-org merge'),
      search: z.string().optional().describe('Name or slug substring, case-insensitive (applied client-side)'),
    },
    // Rows alphabetical with member counts; { teams } key (not items).
    responses: { '200': M.dashboardAdminTeamsList, '401': E, '500': E },
  },
  'POST /api/dashboard/admin/teams': {
    requestBody: R.dashboardCreateTeamBody,
    // Bare team row (no envelope). Names are NOT unique per org; slug collisions
    // retry with a -1..-100 suffix (like dashboard orgs) — so no 409 path exists here.
    // Empty/oversized name → 400 previously unmapped to 500.
    responses: { '201': M.team, '400': E, '401': E, '429': E, '500': E },
  },
  'GET /api/dashboard/admin/teams/{id}': {
    // Team + members (user name/email) + assigned roles.
    responses: { '200': M.teamWithDetails, '401': E, '404': E, '500': E },
  },
  'PATCH /api/dashboard/admin/teams/{id}': {
    requestBody: R.dashboardUpdateTeamBody,
    // Bare updated team row (members NOT included); handler reads name/description only. Empty/oversized name → 400.
    responses: { '200': M.team, '400': E, '401': E, '403': E, '404': E, '429': E, '500': E },
  },
  'DELETE /api/dashboard/admin/teams/{id}': {
    // 409 while the team still has members (remove them first).
    responses: { '200': successResponse, '401': E, '403': E, '404': E, '409': E, '429': E, '500': E },
  },
  'GET /api/dashboard/admin/teams/{id}/members': {
    // { members } rows with per-role names resolved; unpaginated in practice (limit fixed at service).
    responses: { '200': M.teamMembersPage, '401': E, '404': E, '500': E },
  },
  'POST /api/dashboard/admin/teams/{id}/members': {
    requestBody: R.addTeamMemberBody,
    // Bare TeamMember row; duplicate membership → 409; user not in the team's org → 400
    // (both previously unmapped to 500). Grants all team-inherited roles.
    responses: { '201': M.teamMember, '400': E, '401': E, '404': E, '409': E, '429': E, '500': E },
  },
  'DELETE /api/dashboard/admin/teams/{id}/members': {
    requestBody: R.addTeamMemberBody,
    // Body carries userId; revokes team-inherited roles (org-level roles preserved).
    // "User is not a member of this team" → 400 (previously unmapped to 500).
    responses: { '200': successResponse, '400': E, '401': E, '404': E, '429': E, '500': E },
  },
  'GET /api/dashboard/admin/teams/{id}/roles': {
    // BARE ARRAY of assignment rows (junction id + role name/description flattened).
    responses: { '200': z.array(M.teamRoleAssignment), '401': E, '404': E, '500': E },
  },
  'POST /api/dashboard/admin/teams/{id}/roles': {
    requestBody: R.assignTeamRoleBody,
    // Bare TeamRole junction row (no role include); duplicate assignment → 409; role in a
    // different org → 400; missing team/role → 404 (previously unmapped to 500).
    responses: { '201': M.teamRole, '400': E, '401': E, '404': E, '409': E, '429': E, '500': E },
  },
  'DELETE /api/dashboard/admin/teams/{id}/roles': {
    requestBody: R.assignTeamRoleBody,
    // Body carries roleId; unassigned role → 400 (previously unmapped to 500).
    responses: { '200': successResponse, '400': E, '401': E, '404': E, '429': E, '500': E },
  },

  // ---------------------------------------------------------------------------
  // Dashboard users (UserService — same service as the admin surface) + ban toggle.
  // Bare rows throughout; org/role/team filters intersect on user IDs client-side.
  // Quirk: email-clash on PATCH here surfaces as 500 (the handler only maps
  // "User not found" to 404 — no 409 branch), unlike the admin surface.
  // ---------------------------------------------------------------------------
  'GET /api/dashboard/admin/users': {
    parameters: {
      page: z.string().optional().describe('Page number (default 1)'),
      pageSize: z.string().optional().describe('Rows per page (default 20)'),
      search: z.string().optional().describe('Name or email substring, case-insensitive'),
      role: z.string().optional().describe("Filter by membership role, e.g. 'admin'"),
      organizationId: z.string().optional().describe('Scope to members of one organization'),
      teamId: z.string().optional().describe('Intersect with members of one team'),
      status: z.enum(['active', 'banned']).optional().describe('Filter by ban state'),
    },
    // Rows newest-first with counts for stat cards (counts from the filtered dataset).
    responses: { '200': M.dashboardAdminUsersList, '401': E, '500': E },
  },
  'POST /api/dashboard/admin/users': {
    requestBody: R.dashboardCreateUserBody,
    // Bare user row — organizationId required (400); email clash → 409.
    // A credential account is created when a password is given; user is also
    // auto-enrolled in the target org's Members team.
    responses: { '201': M.user, '400': E, '401': E, '409': E, '429': E, '500': E },
  },
  'GET /api/dashboard/admin/users/{id}': {
    responses: { '200': M.user, '401': E, '404': E, '500': E },
  },
  'PATCH /api/dashboard/admin/users/{id}': {
    requestBody: R.updateUserBody,
    // Bare updated user row. Email clash → 500 on this surface (unmapped).
    responses: { '200': M.user, '401': E, '404': E, '429': E, '500': E },
  },
  // Hard delete — Prisma cascades (memberships, team memberships, accounts).
  'DELETE /api/dashboard/admin/users/{id}': {
    responses: { '200': successResponse, '401': E, '404': E, '500': E },
  },
  // Ban toggle — banned omitted flips the current state; unban clears banReason.
  'POST /api/dashboard/admin/users/{id}/ban': {
    requestBody: R.banUserBody,
    responses: { '200': M.user, '401': E, '404': E, '429': E, '500': E },
  },

  // ---------------------------------------------------------------------------
  // Org-scoped teams (TeamService, tenant surface) — org in the path; caller must be
  // a MEMBER of the org AND its role === 'admin' (TENANT_ADMIN), else 403.
  // This surface ENVELOPES create/update results ({ team } / { teamMember } / { teamRole }),
  // unlike the bare-row dashboard sibling. Error mapping is honest here: "not found" → 404,
  // "already" → 409 (slug collisions retry with a suffix inside the service instead).
  // ---------------------------------------------------------------------------
  'GET /api/organizations/{orgId}/teams': {
    parameters: {
      page: z.string().optional().describe('Page number (default 1)'),
      pageSize: z.string().optional().describe('Rows per page (default 20)'),
    },
    // Alphabetical by name; member count per team.
    responses: { '200': M.dashboardAdminTeamsList, '400': E, '401': E, '403': E, '500': E },
  },
  'POST /api/organizations/{orgId}/teams': {
    requestBody: R.createTeamBody,
    // Wrapped team row (plain Team — no _count); slug collisions retry with -1..-100 suffixes.
    responses: {
      '201': z.object({ team: M.team }).meta({ id: 'CreatedTeam' }),
      '400': E, '401': E, '403': E, '409': E, '429': E, '500': E,
    },
  },
  'GET /api/organizations/{orgId}/teams/{teamId}': {
    responses: {
      '200': z.object({ team: M.teamWithDetails }).meta({ id: 'GetTeamDetail' }),
      '401': E, '403': E, '404': E, '500': E,
    },
  },
  'PATCH /api/organizations/{orgId}/teams/{teamId}': {
    requestBody: R.updateTeamBody,
    // Handler reads only name/description — slug is not consumed. At least one field required (400).
    responses: {
      '200': z.object({ team: M.team }).meta({ id: 'TeamUpdateResult' }),
      '400': E, '401': E, '403': E, '404': E, '409': E, '429': E, '500': E,
    },
  },
  // Tenant admins can only delete EMPTY teams (409 otherwise — platform admin bypass is unreachable here).
  'DELETE /api/organizations/{orgId}/teams/{teamId}': {
    responses: { '200': successResponse, '401': E, '403': E, '404': E, '409': E, '500': E },
  },
  'GET /api/organizations/{orgId}/teams/{teamId}/members': {
    parameters: {
      page: z.string().optional().describe('Page number (default 1)'),
      pageSize: z.string().optional().describe('Rows per page (default 20)'),
    },
    responses: { '200': M.teamMembersPage, '401': E, '403': E, '404': E, '500': E },
  },
  'POST /api/organizations/{orgId}/teams/{teamId}/members': {
    requestBody: R.addTeamMemberBody,
    // Target user must already be a member of the org (400); team-inherited roles granted.
    responses: { '201': M.singleTeamMember, '400': E, '401': E, '403': E, '409': E, '429': E, '500': E },
  },
  // userId comes from the QUERY STRING, not the body.
  'DELETE /api/organizations/{orgId}/teams/{teamId}/members': {
    parameters: { userId: z.string().describe('Member to remove (query param, required)') },
    responses: { '200': successResponse, '400': E, '401': E, '403': E, '404': E, '500': E },
  },
  'GET /api/organizations/{orgId}/teams/{teamId}/roles': {
    responses: { '200': M.teamRoleAssignmentsList, '401': E, '403': E, '404': E, '500': E },
  },
  'POST /api/organizations/{orgId}/teams/{teamId}/roles': {
    requestBody: R.assignTeamRoleBody,
    // Role must live in the team's org (403); duplicate assignment → 409.
    responses: { '201': M.singleTeamRole, '400': E, '401': E, '403': E, '404': E, '409': E, '429': E, '500': E },
  },
  // roleId comes from the QUERY STRING, not the body; unassigned role → 404 (not idempotent).
  'DELETE /api/organizations/{orgId}/teams/{teamId}/roles': {
    parameters: { roleId: z.string().describe('Role to remove (query param, required)') },
    responses: { '200': successResponse, '400': E, '401': E, '403': E, '404': E, '500': E },
  },

  // ---------------------------------------------------------------------------
  // Org-scoped calendars + events (CalendarService / CalendarEventService, tenant surface).
  // Reads: any MEMBER or a platform super admin. Writes (POST/PATCH/DELETE): role !== 'MEMBER'
  // else 403 — and every write is per-user rate-limited (429). Calendar rows omit organizationId;
  // event rows carry a parsed recurrence object plus the raw rrule JSON.
  // ---------------------------------------------------------------------------
  'GET /api/organizations/{orgId}/calendar': {
    // Bare array, isDefault first then alphabetical by name.
    responses: { '200': M.calendarListBare, '401': E, '500': E },
  },
  'POST /api/organizations/{orgId}/calendar': {
    requestBody: R.createCalendarBody,
    // Color comes from a rotating palette; isDefault is false. Name clash in org → 409.
    responses: { '201': M.singleCalendar, '400': E, '401': E, '403': E, '409': E, '429': E, '500': E },
  },
  'GET /api/organizations/{orgId}/calendar/{id}': {
    // Bare row (handler returns the service row directly — no envelope).
    responses: { '200': M.calendar, '401': E, '404': E, '500': E },
  },
  'PATCH /api/organizations/{orgId}/calendar/{id}': {
    requestBody: R.updateCalendarBody,
    // Name collision on this surface throws ValidationError → 400 (no 409 branch in catch).
    responses: { '200': M.singleCalendar, '400': E, '401': E, '403': E, '404': E, '429': E, '500': E },
  },
  // Deleting the org's default calendar → 400; events on the calendar cascade-delete.
  'DELETE /api/organizations/{orgId}/calendar/{id}': {
    responses: { '200': successResponse, '400': E, '401': E, '403': E, '404': E, '500': E },
  },

  // ---------------------------------------------------------------------------
  // Org-scoped calendar events. GET list expands recurring series into per-occurrence
  // instances (each sharing the base event id) — sorted by start date, deduplicated.
  // ---------------------------------------------------------------------------
  'GET /api/organizations/{orgId}/calendar-events': {
    parameters: {
      start: z.string().describe('Range start (ISO 8601, required)'),
      end: z.string().describe('Range end (ISO 8601, required)'),
      calendarId: z.string().optional().describe('Restrict to one calendar'),
    },
    // Bare array — recurring events expanded to occurrences within [start, end].
    responses: { '200': M.calendarEventsBare, '400': E, '401': E, '500': E },
  },
  'POST /api/organizations/{orgId}/calendar-events': {
    requestBody: R.createCalendarEventBody,
    // Missing title/dates/calendarId → 400; unknown calendarId → 404 (service check).
    responses: { '201': M.singleCalendarEvent, '400': E, '401': E, '403': E, '404': E, '429': E, '500': E },
  },
  'GET /api/organizations/{orgId}/calendar-events/upcoming': {
    parameters: { limit: z.string().optional().describe('Max events to return (default 10)') },
    // Bare array — next 30 days, non-recurring + expanded recurring occurrences, sorted by start.
    responses: { '200': M.calendarEventsBare, '400': E, '401': E, '429': E, '500': E },
  },
  // GET/PATCH/DELETE a single event. PATCH supports recurring-edit scopes for events with an rrule:
  // editScope "this" returns the generated override row, "following" the new series head, "all" the
  // updated base — all as raw Prisma findFirst rows (hence no parsed recurrence, but organizationId
  // present). Without editScope: plain { event } service row.
  'GET /api/organizations/{orgId}/calendar-events/{id}': {
    // Bare service-mapped row (includes parsed recurrence).
    responses: { '200': M.calendarEvent, '401': E, '404': E, '500': E },
  },
  'PATCH /api/organizations/{orgId}/calendar-events/{id}': {
    requestBody: R.updateCalendarEventBody,
    // editScope present on recurring rows; recurring events' raw rows include organizationId.
    responses: { '200': M.calendarEventUpdateResult, '401': E, '403': E, '404': E, '429': E, '500': E },
  },
  'DELETE /api/organizations/{orgId}/calendar-events/{id}': {
    responses: { '200': successResponse, '401': E, '403': E, '404': E, '429': E, '500': E },
  },

  // ---------------------------------------------------------------------------
  // Org-scoped calendar notifications (direct DB reads — membership via tenantDb.member
  // instead of resolveTenantAccess). All ops rate-limited; non-members → 403.
  // Writes/history require role === 'admin' (TENANT_ADMIN); plain reads open to any member.
  // ---------------------------------------------------------------------------
  // Send today's event notifications — org-wide by default; a single userId restricts to
  // that member. No events today → empty results ({} summary still computed from []).
  'POST /api/organizations/{orgId}/calendar-notifications/send-today': {
    requestBody: M.sendTodayNotificationBody,
    responses: { '200': M.sendTodayNotificationsResponse, '400': E, '401': E, '403': E, '404': E, '429': E, '500': E },
  },
  // Today's events for notification purposes — bare array of the subset rows.
  'GET /api/organizations/{orgId}/calendar-notifications/today': {
    responses: { '200': M.todayCalendarEventsBare, '400': E, '401': E, '403': E, '429': E, '500': E },
  },
  // Delivery history — newest first; eventType filter + pagination. Tenant admin only.
  'GET /api/organizations/{orgId}/calendar-notifications/history': {
    parameters: {
      eventType: z.string().optional().describe('Filter by event type (e.g. "TODAY_EVENTS")'),
      page: z.string().optional().describe('Page number (default 1)'),
      pageSize: z.string().optional().describe('Rows per page (default 20)'),
    },
    responses: { '200': M.calendarNotificationHistory, '400': E, '401': E, '403': E, '429': E, '500': E },
  },

  // ---------------------------------------------------------------------------
  // Org chart — full organization → teams → members tree with per-member roles + permission keys.
  // Membership OR super admin via resolveTenantAccess; viewerCanEdit for platform/tenant admins.
  // Members render under at most ONE team (primary = earliest join, A–Z tiebreak).
  // ---------------------------------------------------------------------------
  'GET /api/organizations/{orgId}/org-chart': {
    responses: { '200': M.orgChartTree, '400': E, '401': E, '403': E, '404': E, '500': E },
  },

  // ---------------------------------------------------------------------------
  // Org roles — membership-scoped read-only rolename list for the tenant
  // dashboard (the full CRUD surface stays under /api/admin/organizations).
  // Membership OR super admin via resolveTenantAccess.
  // ---------------------------------------------------------------------------
  'GET /api/organizations/{orgId}/roles': {
    responses: { '200': M.orgRolesList, '401': E, '403': E, '500': E },
  },

  // ---------------------------------------------------------------------------
  // Payload encryption keys — authenticated session issues short-lived AES-256-GCM key material
  // (base64url) + metadata; responses carry Cache-Control: no-store. Trust check on the raw
  // { error } literal bodies of this surface.
  // ---------------------------------------------------------------------------
  'POST /api/security/payload-key': {
    responses: { '200': M.payloadKeyResponse, '401': E, '403': E, '429': E, '500': E },
  },
  // Revokes ALL payload keys for the calling session (called on logout). No body; { message } ack.
  'POST /api/security/payload-key/revoke': {
    responses: { '200': msg('ok'), '401': E, '403': E, '429': E, '500': E },
  },

  // ---------------------------------------------------------------------------
  // Platform observability — payload-encryption counters. Super admin only
  // (requireSuperAdmin), rate-limited per session; ?reset=true zeroes the counters.
  // NOTE: the guard was imported but never invoked until B15 — now applied.
  // ---------------------------------------------------------------------------
  'GET /api/admin/payload-encryption/metrics': {
    parameters: { reset: z.string().optional().describe('"true" zeroes all counters before responding') },
    responses: { '200': M.payloadEncryptionMetrics, '401': E, '403': E, '429': E, '500': E, '503': E },
  },

  // ---------------------------------------------------------------------------
  // Dashboard admin index route (app/api/dashboard/admin/route.ts) — JSDoc-declared path is
  // /api/dashboard/admin/stats. Cross-org aggregate totals under a verified platform context.
  // Super admin only (requireSuperAdmin).
  // ---------------------------------------------------------------------------
  'GET /api/dashboard/admin/stats': {
    responses: { '200': M.dashboardAdminStats, '401': E, '403': E, '500': E },
  },
};
