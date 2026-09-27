import { z } from 'zod';
import {
  calendarEventType,
  idField,
  listEnvelope,
  notificationPriority,
  notificationScope,
  orgStatus,
  ts,
} from './common';

/**
 * Shared domain models for API docs — response/request shapes that recur
 * across multiple route files. Field sets mirror prisma/schema.prisma;
 * relations are flattened to the scalar subset the routes actually emit.
 */

// ---------------------------------------------------------------------------
// Users / Members
// ---------------------------------------------------------------------------

export const user = z
  .object({
    id: idField('User ID (cuid)'),
    name: z.string(),
    email: z.string().email(),
    emailVerified: z.boolean(),
    image: z.string().nullable(),
    role: z.string().describe("BetterAuth membership role, e.g. 'member', 'admin'"),
    banned: z.boolean().nullable(),
    banReason: z.string().nullable(),
    banExpires: ts.nullable(),
    createdAt: ts,
    updatedAt: ts,
    // Present on some listings (dashboard admin users), omitted on others — optional keeps both honest.
    activeOrganizationId: z.string().nullable().optional(),
  })
  .meta({ id: 'User' });

export const member = z
  .object({
    id: idField('Membership ID (cuid)'),
    role: z.string().describe("Member role, e.g. 'admin', 'manager', 'member'"),
    userId: idField('User ID'),
    orgId: idField('Organization ID'),
    teamId: z.string().nullable(),
    createdAt: ts,
    updatedAt: ts,
  })
  .meta({ id: 'Member' });

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

export const organization = z
  .object({
    id: idField('Organization ID (cuid)'),
    name: z.string(),
    slug: z.string().nullable(),
    description: z.string().nullable(),
    status: orgStatus,
    metadata: z.unknown().nullable(),
    createdAt: ts,
    updatedAt: ts,
  })
  .meta({ id: 'Organization' });

/** GET /api/admin/organizations/[orgId] — adds rollup counts. */
export const organizationDetail = z
  .object({
    id: idField('Organization ID'),
    name: z.string(),
    slug: z.string().nullable(),
    status: orgStatus,
    metadata: z.unknown().nullable(),
    createdAt: ts,
    updatedAt: ts,
    memberCount: z.number(),
    customRoleCount: z.number(),
  })
  .meta({ id: 'OrganizationDetail' });

/** Organization row as emitted by getPaginatedOrganizations (counts projected). */
export const organizationListItem = z
  .object({
    id: idField('Organization ID'),
    name: z.string(),
    slug: z.string().nullable(),
    description: z.string().nullable(),
    memberCount: z.number(),
    teamCount: z.number(),
    _count: z.object({ members: z.number() }),
    createdAt: ts,
    updatedAt: ts,
  })
  .meta({ id: 'OrganizationListItem' });

/** GET /api/admin/organizations & dashboard orgs list — orgs + pagination + global dash stats. */
export const paginatedOrganizations = z
  .object({
    organizations: z.array(organizationListItem),
    pagination: z.object({ page: z.number(), pageSize: z.number(), total: z.number(), totalPages: z.number() }),
    globalTotal: z.number().describe('All orgs regardless of filters (dashboard stat cards)'),
    statusCounts: z.object({ ACTIVE: z.number(), PENDING: z.number(), SUSPENDED: z.number(), ARCHIVED: z.number() }),
  })
  .meta({ id: 'PaginatedOrganizations' });

/** Org list option rows (GET /api/admin/organizations/list). */
export const organizationOption = z
  .object({
    id: idField('Organization ID'),
    name: z.string(),
    isPlatform: z.boolean().optional().describe('Present on the synthetic Platform entry'),
    status: orgStatus.optional(),
  })
  .meta({ id: 'OrganizationOption' });

export const organizationListOptions = z
  .object({ organizations: z.array(organizationOption) })
  .meta({ id: 'OrganizationListOptions' });

// ---------------------------------------------------------------------------
// Teams (org-scoped)
// ---------------------------------------------------------------------------

export const team = z
  .object({
    id: idField('Team ID (cuid)'),
    name: z.string(),
    slug: z.string().nullable(),
    description: z.string().nullable(),
    organizationId: idField('Organization ID'),
    createdAt: ts,
    updatedAt: ts,
  })
  .meta({ id: 'Team' });

/** Team row as returned by TeamService.getTeamsByOrg (member count included). */
export const teamWithMemberCount = team
  .extend({ _count: z.object({ members: z.number() }).describe('Number of team members') })
  .meta({ id: 'TeamWithMemberCount' });

/** TeamMember row as emitted by TeamService.addTeamMember. */
export const teamMember = z
  .object({
    id: idField('TeamMember ID (cuid)'),
    teamId: idField('Team ID'),
    userId: idField('User ID'),
    organizationId: idField('Organization ID'),
    createdAt: ts,
  })
  .meta({ id: 'TeamMember' });

/** Team member row as emitted by getTeamById (user select folded in). */
export const teamDetailMember = z
  .object({
    id: idField('TeamMember ID'),
    userId: idField('User ID'),
    user: z.object({ name: z.string(), email: z.string().email() }),
    createdAt: ts,
  })
  .meta({ id: 'TeamDetailMember' });

// ---------------------------------------------------------------------------
// Roles / permissions (RBAC)
// ---------------------------------------------------------------------------

export const permission = z
  .object({
    id: idField('Permission ID (cuid)'),
    key: z.string().describe('Permission key, e.g. "properties:view"'),
    resource: z.string().describe('Resource segment of the key, e.g. "properties"'),
    action: z.string().describe('Action segment of the key, e.g. "view"'),
    description: z.string().nullable(),
    isDefault: z.boolean().describe('true = bootstrapped permission'),
    createdAt: ts,
  })
  .meta({ id: 'Permission' });

export const role = z
  .object({
    id: idField('Role ID (cuid)'),
    name: z.string(),
    description: z.string().nullable(),
    isDefault: z.boolean(),
    organizationId: idField('Organization ID'),
    createdAt: ts,
  })
  .meta({ id: 'Role' });

/** Team detail (GET /teams/[teamId]) — members and roles included. */
export const teamDetailRole = z
  .object({
    id: idField('Role ID'),
    name: z.string(),
    description: z.string().nullable(),
  })
  .meta({ id: 'TeamDetailRole' });

export const teamWithDetails = team.extend({
  members: z.array(teamDetailMember),
  roles: z.array(teamDetailRole).describe('Roles assigned to this team'),
}).meta({ id: 'TeamWithDetails' });



/** Platform-scope role row (GET /api/admin/roles) — org membership optional. */
export const platformRole = z
  .object({
    id: idField('Role ID (cuid)'),
    name: z.string(),
    description: z.string().nullable(),
    isDefault: z.boolean(),
    organizationId: z.string().nullable().describe('null for roles with no tenant org'),
    permissions: z.array(z.string()).optional().describe('Permission keys granted through this role (some listings)'),
    createdAt: ts,
  })
  .meta({ id: 'PlatformRole' });

/** Role row as emitted by RoleService.list (member count projected). */
export const roleListItem = role
  .extend({ _count: z.object({ memberRoles: z.number() }) })
  .meta({ id: 'RoleListItem' });

export const paginatedOrgRoles = listEnvelope(roleListItem, 'OrgRoles');

/** Roles-list extras returned by some list endpoints (e.g. dashboard/admin/roles). */
export const roleListCounts = z.object({
  defaultCount: z.number(),
  customCount: z.number(),
  rolesInUseCount: z.number(),
}).meta({ id: 'RoleListCounts' });

/** Permission grid row for the org permissions matrix (GET /api/admin/organizations/[orgId]/permissions). */
export const permissionGridRow = z
  .object({
    roleId: idField('Role ID'),
    roleName: z.string(),
    isDefault: z.boolean(),
    permissions: z.array(
      z.object({
        key: z.string(),
        resource: z.string(),
        action: z.string(),
        assigned: z.boolean(),
      }),
    ),
  })
  .meta({ id: 'PermissionGridRow' });

export const permissionsMatrix = z
  .object({
    roles: z.array(permissionGridRow),
    allPermissions: z.array(permission),
  })
  .meta({ id: 'PermissionsMatrix' });

/** Role-permission junction row (dashboard role permission assignments). */
export const rolePermissionAssignment = z
  .object({
    id: idField('RolePermission ID'),
    roleId: idField('Role ID'),
    permissionId: idField('Permission ID'),
    organizationId: idField('Organization ID'),
    createdAt: ts,
  })
  .meta({ id: 'RolePermissionAssignment' });

export const rolePermissionsList = z.object({ permissions: z.array(rolePermissionAssignment) }).meta({
  id: 'RolePermissionsList',
});

/** Compact role row used by /api/roles/search cache + responses. */
export const roleSearchResult = z
  .object({
    id: idField('Role ID'),
    name: z.string(),
    description: z.string().nullable(),
  })
  .meta({ id: 'RoleSearchResult' });

// ---------------------------------------------------------------------------
// List envelopes (service PaginatedResult)
// ---------------------------------------------------------------------------

export const paginatedPlatformRoles = listEnvelope(platformRole, 'PlatformRoles');
export const paginatedPermissions = listEnvelope(permission, 'Permissions');

/** Users list rows carry the member count projection from UserService.list. */
const userListRow = user.extend({ _count: z.object({ members: z.number() }) }).meta({ id: 'UserListRow' });
export const paginatedUsers = listEnvelope(userListRow, 'Users');

/** Dashboard admin roles list — items + pagination + counts extras. */
export const dashboardAdminRolesList = z
  .object({
    items: z.array(roleListItem),
    pagination: z.object({ page: z.number(), pageSize: z.number(), total: z.number(), totalPages: z.number() }),
    counts: roleListCounts,
  })
  .meta({ id: 'DashboardAdminRolesList' });

/** Dashboard admin users list — items + pagination + count breakdown. */
export const dashboardAdminUsersList = z
  .object({
    items: z.array(userListRow),
    pagination: z.object({ page: z.number(), pageSize: z.number(), total: z.number(), totalPages: z.number() }),
    counts: z.object({
      emailVerifiedCount: z.number(),
      bannedCount: z.number(),
      activeCount: z.number(),
    }),
  })
  .meta({ id: 'DashboardAdminUsersList' });

/** Dashboard admin teams list — { teams: [...] } + pagination. */
export const dashboardAdminTeamsList = z
  .object({
    teams: z.array(teamWithMemberCount),
    pagination: z.object({ page: z.number(), pageSize: z.number(), total: z.number(), totalPages: z.number() }),
  })
  .meta({ id: 'DashboardAdminTeamsList' });

// ---------------------------------------------------------------------------
// Notifications (in-app)
// ---------------------------------------------------------------------------

export const notification = z
  .object({
    id: idField('Notification ID (cuid)'),
    title: z.string(),
    message: z.string(),
    priority: notificationPriority,
    scope: notificationScope,
    organizationId: z.string().nullable(),
    source: z.string().nullable().describe('e.g. "admin:message", "health-check:database"'),
    acknowledged: z.boolean(),
    createdAt: ts,
  })
  .meta({ id: 'Notification' });

/** Admin notifications listing row — adds resolved organization name. */
export const notificationAdmin = notification
  .extend({ organizationName: z.string().nullable() })
  .meta({ id: 'NotificationAdmin' });

/** Per-recipient outcome of send-today calendar notifications. */
export const sendNotificationResult = z
  .object({
    status: z.enum(['SENT', 'FAILED', 'RATE_LIMITED']),
    recipientEmail: z.string().optional(),
    eventId: z.string().optional(),
    error: z.string().optional(),
  })
  .meta({ id: 'SendNotificationResult' });

export const sendTodayNotificationsResponse = z
  .object({
    results: z.array(sendNotificationResult),
    summary: z.object({ sent: z.number(), rateLimited: z.number(), failed: z.number() }),
  })
  .meta({ id: 'SendTodayNotificationsResponse' });

// ---------------------------------------------------------------------------
// Calendar (org-scoped)
// ---------------------------------------------------------------------------

export const calendar = z
  .object({
    id: idField('Calendar ID (cuid)'),
    name: z.string(),
    description: z.string().nullable(),
    color: z.string().describe('Color theme, e.g. #1B2A4A'),
    isDefault: z.boolean(),
    organizationId: idField('Organization ID'),
    createdAt: ts,
    updatedAt: ts,
  })
  .meta({ id: 'Calendar' });

const calendarEventBase = z
  .object({
    id: idField('Event ID (cuid)'),
    title: z.string(),
    description: z.string().nullable(),
    startDate: ts,
    endDate: ts,
    eventType: calendarEventType,
    color: z.string().nullable(),
    calendarId: idField('Calendar ID'),
    rrule: z.unknown().nullable().describe('RFC 5545 recurrence rule (JSON) for recurring events'),
    exdates: z.array(z.string()).default([]).describe('Excluded occurrence dates (YYYY-MM-DD)'),
    propertyId: z.string().nullable(),
    organizationId: idField('Organization ID'),
    createdAt: ts,
    updatedAt: ts,
  })
  .meta({ id: 'CalendarEvent' });

export const calendarEvent = calendarEventBase;
export const calendarEventList = z.array(calendarEvent).meta({ id: 'CalendarEventList' });

/** Recurring-edit envelope returned by PATCH /calendar-events/[id]. */
export const calendarEventWithEditScope = z
  .object({
    event: calendarEvent,
    editScope: z.enum(['this', 'following', 'all']).describe('Which occurrences the update applied to'),
  })
  .meta({ id: 'CalendarEventWithEditScope' });

// ---------------------------------------------------------------------------
// Job scheduler (platform)
// ---------------------------------------------------------------------------

export const jobDefinition = z
  .object({
    id: idField('Job ID (cuid)'),
    name: z.string(),
    description: z.string().nullable(),
    handlerKey: z.string(),
    scheduleExpr: z.string().describe("Schedule JSON string, e.g. { kind: 'cron', cron: '* * * * *' }"),
    timezone: z.string().nullable(),
    timeoutMs: z.number().nullable(),
    concurrencyLimit: z.number(),
    enabled: z.boolean(),
    approved: z.boolean(),
    approvedBy: z.string().nullable(),
    approvalNote: z.string().nullable(),
    lastRunAt: ts.nullable(),
    lastRunStatus: z.string().nullable(),
    platformOrgId: idField('Platform organization ID'),
    createdAt: ts,
    updatedAt: ts,
  })
  .meta({ id: 'JobDefinition' });

export const jobExecution = z
  .object({
    id: idField('Execution ID (cuid)'),
    jobDefinitionId: idField('Job ID'),
    startedAt: ts,
    finishedAt: ts.nullable(),
    status: z.string().describe('PENDING | RUNNING | SUCCEEDED | FAILED | CANCELLED'),
    trigger: z.string().describe('SCHEDULE | MANUAL'),
    actorId: z.string().nullable(),
    error: z.string().nullable(),
    resultJson: z.unknown().nullable(),
    source: z.literal('job-scheduler:execution'),
    createdAt: ts,
  })
  .meta({ id: 'JobExecution' });

/** Platform jobs list (GET /api/admin/jobs & dashboard scripts) — paginated. */
export const paginatedJobs = z
  .object({
    items: z.array(jobDefinition),
    pagination: z.object({ page: z.number(), pageSize: z.number(), total: z.number() }),
  })
  .meta({ id: 'PaginatedJobs' });

/** Dashboard scripts list — paginated jobs + stat-card counts. */
export const dashboardScriptsList = z
  .object({
    items: z.array(jobDefinition),
    pagination: z.object({ page: z.number(), pageSize: z.number(), total: z.number() }),
    counts: z.object({
      totalCount: z.number(),
      approvedCount: z.number(),
      unapprovedCount: z.number(),
      enabledCount: z.number(),
      disabledCount: z.number(),
    }),
  })
  .meta({ id: 'DashboardScriptsList' });

/** Script detail (dashboard) — definition + recent executions. */
export const scriptDetailResponse = z
  .object({
    job: jobDefinition,
    executions: z.array(jobExecution),
  })
  .meta({ id: 'ScriptDetailResponse' });

// ---------------------------------------------------------------------------
// Org chart (lib/org-chart.ts ChartTree)
// ---------------------------------------------------------------------------

export const orgChartRole = z.object({
  id: idField('Role ID'),
  name: z.string(),
  permissionCount: z.number(),
  permissions: z.array(z.string()).describe('Permission keys (resource:action)'),
}).meta({ id: 'OrgChartRole' });

export const orgChartMember = z
  .object({
    userId: idField('User ID'),
    name: z.string(),
    email: z.string().email(),
    image: z.string().nullable(),
    memberRole: z.string(),
    assignedRoles: z.array(orgChartRole),
    teams: z.array(z.string()).describe('Team slugs, primary first'),
  })
  .meta({ id: 'OrgChartMember' });

export const orgChartTeam = z
  .object({
    id: idField('Team ID'),
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    members: z.array(orgChartMember),
  })
  .meta({ id: 'OrgChartTeam' });

export const orgChartTree = z
  .object({
    organization: z.object({
      id: idField('Organization ID'),
      name: z.string(),
      description: z.string().nullable(),
      status: orgStatus,
    }),
    teams: z.array(orgChartTeam),
    unassigned: z.array(orgChartMember).describe('Org members with no team membership'),
    viewerCanEdit: z.boolean(),
  })
  .meta({ id: 'OrgChartTree' });

// ---------------------------------------------------------------------------
// Health / metrics
// ---------------------------------------------------------------------------

const healthCheck = z
  .object({
    status: z.string().describe('healthy | unhealthy | degraded'),
    latency_ms: z.number().optional(),
    error: z.string().optional(),
  })
  .meta({ id: 'HealthCheck' });

export const healthResponse = z
  .object({
    status: z.string().describe('healthy | unhealthy (drives HTTP 200 vs 503)'),
    timestamp: ts,
    uptime: z.number().describe('Process uptime in seconds'),
    checks: z.record(z.string(), healthCheck),
  })
  .meta({ id: 'HealthResponse' });

export const cacheMetricsResponse = z
  .object({
    l1: z.object({
      hits: z.number(),
      misses: z.number(),
      hitRate: z.number().describe('Percentage 0–100'),
      size: z.number().describe('Entries in the L1 cache'),
      memoryBytes: z.number(),
      memoryMB: z.number(),
    }),
    l2: z.object({
      hits: z.number(),
      misses: z.number(),
      hitRate: z.number().describe('Percentage 0–100 (Redis)'),
    }),
    redisConnected: z.boolean(),
  })
  .meta({ id: 'CacheMetricsResponse' });

export const cacheMetricsDetailResponse = z
  .object({
    success: z.literal(true),
    data: z.object({
      metrics: z.record(z.string(), z.number()),
      l1Details: z.object({ enabled: z.boolean(), maxSize: z.number(), maxEntrySize: z.number() }),
      timestamp: ts,
    }),
  })
  .meta({ id: 'CacheMetricsDetailResponse' });

export const payloadEncryptionMetrics = z
  .object({
    encryptedRequestCount: z.number(),
    encryptedResponseCount: z.number(),
    decryptionFailures: z.number(),
    unknownKeyIds: z.number(),
    expiredKeys: z.number(),
    replayDetections: z.number(),
    staleTimestamps: z.number(),
    payloadTooLarge: z.number(),
    replayCacheUnavailable: z.number(),
    plaintextPermissive: z.number(),
    keyIssuanceCount: z.number(),
    keyRateLimited: z.number(),
    responseEncryptionFailures: z.number(),
  })
  .meta({ id: 'PayloadEncryptionMetrics' });

// ---------------------------------------------------------------------------
// Session / permission context (auth)
// ---------------------------------------------------------------------------

export const sessionUserResponse = z
  .object({
    userId: idField('User ID'),
    email: z.string().email(),
    name: z.string(),
    activeOrganizationId: z.string().nullable(),
    organizationName: z.string(),
  })
  .meta({ id: 'SessionUserResponse' });

export const permissionContextResponse = z
  .object({
    userId: idField('User ID'),
    activeOrganizationId: z.string().nullable(),
    platformOrgId: z.string().nullable(),
    isSuperAdmin: z.boolean(),
    permissions: z.array(z.string()).describe("Permission keys, or ['*'] for super admin"),
  })
  .meta({ id: 'PermissionContextResponse' });

export const permissionListResponse = z.object({ permissions: z.array(permission) }).meta({
  id: 'PermissionListResponse',
});

// ---------------------------------------------------------------------------
// Resources (global catalog)
// ---------------------------------------------------------------------------

/** Resource row (global feature-module catalog). */
export const resourceRow = z
  .object({
    id: idField('Resource ID (cuid)'),
    name: z.string(),
    description: z.string().nullable(),
    createdAt: ts,
    updatedAt: ts,
  })
  .meta({ id: 'Resource' });

export const resourceList = z.object({ resources: z.array(resourceRow) }).meta({ id: 'ResourceList' });
export const paginatedResources = listEnvelope(resourceRow, 'Resources');

// ---------------------------------------------------------------------------
// Audit / notification logs
// ---------------------------------------------------------------------------

/** Audit log row (GET /api/admin/audit-logs). */
export const auditLogRow = z
  .object({
    id: idField('Audit log ID (cuid)'),
    timestamp: ts,
    userId: z.string().nullable(),
    userName: z.string().nullable(),
    action: z.string().describe('e.g. "organization.created", "role.deleted"'),
    resourceType: z.string().describe('e.g. "Organization", "Role", "Permission"'),
    resourceId: z.string().nullable(),
    organizationId: z.string().nullable(),
    success: z.boolean(),
  })
  .meta({ id: 'AuditLogRow' });

/** Audit log listing (GET /api/admin/audit-logs). */
export const auditLogList = z
  .object({
    auditLogs: z.array(auditLogRow),
    total: z.number(),
  })
  .meta({ id: 'AuditLogList' });

/** Notification log row (calendar-notifications/history). */
export const calendarNotificationLog = z
  .object({
    id: idField('Notification log ID (cuid)'),
    recipientEmail: z.string().email(),
    eventType: z.string(),
    message: z.string().nullable(),
    status: z.enum(['SENT', 'FAILED']).describe('Delivery status'),
    timestamp: ts,
  })
  .meta({ id: 'CalendarNotificationLog' });

/** Calendar notification history envelope. */
export const calendarNotificationHistory = z
  .object({
    logs: z.array(calendarNotificationLog),
    pagination: z.object({ page: z.number(), pageSize: z.number(), total: z.number() }),
  })
  .meta({ id: 'CalendarNotificationHistory' });

// ---------------------------------------------------------------------------
// Search envelopes — { results, total } returned by /search endpoints
// ---------------------------------------------------------------------------

export function searchEnvelope<T extends z.ZodType>(item: T, idSuffix: string) {
  return z
    .object({
      results: z.array(item),
      total: z.number(),
    })
    .meta({ id: `Search${idSuffix}` });
}

export const searchOrganizationsResults = searchEnvelope(organization, 'Organizations');
export const searchUsersResults = searchEnvelope(user, 'Users');
export const searchPermissionsResults = searchEnvelope(permission, 'Permissions');
export const searchRolesResults = searchEnvelope(roleSearchResult, 'Roles');

// ---------------------------------------------------------------------------
// Payload encryption / session keys
// ---------------------------------------------------------------------------

/** Payload key issued by POST /api/security/payload-key. */
export const payloadKeyResponse = z
  .object({
    keyId: z.string(),
    algorithm: z.string(),
    expiresAt: ts,
    key: z.string().describe('Key material — treat as secret'),
    sessionId: z.string(),
  })
  .meta({ id: 'PayloadKeyResponse' });

// ---------------------------------------------------------------------------
// Role members (dashboard)
// ---------------------------------------------------------------------------

export const roleMembersList = z
  .object({
    members: z.array(
      z.object({
        id: idField('MemberRole ID'),
        member: user,
        roleId: idField('Role ID'),
        createdAt: ts,
      }),
    ),
  })
  .meta({ id: 'RoleMembersList' });

// ---------------------------------------------------------------------------
// Single-resource wrappers — the routes wrap created/updated rows in an
// object named after the resource
// ---------------------------------------------------------------------------

export const singleOrganization = z.object({ organization: organization }).meta({ id: 'SingleOrganization' });
export const singleUser = z.object({ user: user }).meta({ id: 'SingleUser' });
export const singleRole = z.object({ role: role }).meta({ id: 'SingleRole' });
export const singlePermission = z.object({ permission: permission }).meta({ id: 'SinglePermission' });
export const singleTeam = z.object({ team: teamWithDetails }).meta({ id: 'SingleTeam' });
export const singleCalendar = z.object({ calendar: calendar }).meta({ id: 'SingleCalendar' });
export const singleJob = z.object({ job: jobDefinition }).meta({ id: 'SingleJob' });
export const singleResource = z.object({ resource: resourceRow }).meta({ id: 'SingleResource' });

// ---------------------------------------------------------------------------
// Org members (admin org-scoped)
// ---------------------------------------------------------------------------

/** Org member list (GET /api/admin/organizations/[orgId]/members). */
export const orgMemberList = z.object({ members: z.array(member) }).meta({ id: 'OrgMemberList' });

export const addedMember = z.object({ message: z.string(), member: member }).meta({ id: 'AddedMember' });
export const updatedMember = z.object({ message: z.string(), member: member }).meta({ id: 'UpdatedMember' });

// ---------------------------------------------------------------------------
// Message confirmations with resource payloads
// ---------------------------------------------------------------------------

export const createdRole = z
  .object({
    message: z.string().describe('e.g. "Role created successfully"'),
    role: role,
  })
  .meta({ id: 'CreatedRole' });

/** Org-roles list — flat { roles } envelope (admin org-scoped GET). */
export const orgRolesList = z.object({ roles: z.array(roleListItem) }).meta({ id: 'OrgRolesList' });

/** Team role list (GET /teams/[teamId]/roles). */
export const teamRolesList = z
  .object({ roles: z.array(role.describe('Role assigned to this team')) })
  .meta({ id: 'TeamRolesList' });

/** Dashboard admin stats (GET /api/dashboard/admin). */
export const dashboardAdminStats = z
  .object({
    users: z.object({ total: z.number() }),
    organizations: z.object({ total: z.number() }),
    teams: z.object({ total: z.number() }),
    roles: z.object({ total: z.number() }),
    permissions: z.object({ total: z.number() }),
  })
  .meta({ id: 'DashboardAdminStats' });
