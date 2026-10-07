import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

import { UserService } from '@/services/user-service';
// RLS Phase 3: dashboard user listing/creation run under verified contexts.
import tenantDb from '@/lib/tenant-db';
import { withPlatformContext, withTenantAdminContext } from '@/lib/platform-db';
import type { Prisma } from '@prisma/client';
import { issueInviteLink } from '@/lib/oidc-magic-link';
import { recordAuditLog } from '@/lib/audit-log';
import { notifyUserOperation } from '@/lib/notification-push';

export const runtime = 'nodejs';

/**
 * GET /api/dashboard/admin/users
 * List users with pagination, search, and filters.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const pageSize = parseInt(url.searchParams.get('pageSize') || '20', 10);
    const search = url.searchParams.get('search') || undefined;
    const role = url.searchParams.get('role') || undefined;
    const organizationId = url.searchParams.get('organizationId') || undefined;
    const teamId = url.searchParams.get('teamId') || undefined;
    const status = url.searchParams.get('status') as 'active' | 'banned' | undefined;

    // One verified platform context for the whole listing (cross-org reads).
    return await withPlatformContext(auth.session!.user.id, async () => {
      // Build the shared where clause so counts match filtered results
      const where: Prisma.UserWhereInput = {};
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ];
      }

      // Platform Admin: apply org/role/team filters to the where clause for counts
      if (organizationId || role || teamId) {
        const memberWhere: Prisma.MemberWhereInput = {};
        if (organizationId) memberWhere.orgId = organizationId;
        if (role) memberWhere.role = role;

        let userIds: string[] = [];
        if (organizationId || role) {
          const matchingMembers = await tenantDb.member.findMany({
            where: memberWhere,
            select: { userId: true },
          });
          userIds = matchingMembers.map((m) => m.userId);
        }

        if (teamId) {
          const teamMembers = await tenantDb.teamMember.findMany({
            where: { teamId },
            select: { userId: true },
          });
          const teamUserIds = new Set(teamMembers.map((tm) => tm.userId));
          userIds = userIds.length > 0
            ? userIds.filter((id) => teamUserIds.has(id))
            : Array.from(teamUserIds);
        }

        if (userIds.length > 0) {
          where.id = { in: userIds };
        } else {
          where.id = { in: [] };
        }
      }

      // Apply status filter to where clause for counts
      if (status === 'banned') {
        where.banned = true;
      } else if (status === 'active') {
        where.banned = false;
      }

      // Fetch paginated items for the table (UserService runs in this context)
      const result = await UserService.list(
        { search, role, organizationId, teamId, status },
        { page, pageSize },
        { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' }
      );

      // Compute counts from the full dataset using separate count queries
      const [emailVerifiedCount, bannedCount] = await Promise.all([
        tenantDb.user.count({ where: { ...where, emailVerified: true } }),
        tenantDb.user.count({ where: { ...where, banned: true } }),
      ]);

      // Never ship passwordHash to the client — replace it with a derived
      // boolean so the UI can tell invite-pending (passwordless, unverified)
      // users from regular ones.
      const safeItems = result.items.map((u) => {
        const { passwordHash, ...rest } = u;
        return { ...rest, passwordHashPresent: Boolean(passwordHash) };
      });

      return NextResponse.json({
        ...result,
        items: safeItems,
        counts: {
          emailVerifiedCount,
          bannedCount,
          activeCount: result.pagination.total - bannedCount,
        },
      });
    });
  } catch (error) {
    console.error('Failed to list users:', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}

/**
 * POST /api/dashboard/admin/users
 * Create a new user.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Rate limit write operations by session
  if (!checkAdminRateLimit(auth.session!.user.id)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  let body: { name?: string; email?: string; password?: string; organizationId?: string; teamId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const organizationId = body.organizationId;
  const password = body.password;

  if (!organizationId) {
    return NextResponse.json({ error: 'Organization is required' }, { status: 400 });
  }

  if (!body.name || !body.email) {
    return NextResponse.json({ error: 'Name and email are required' }, { status: 400 });
  }

  // Capture narrowed values (const) so the async closure below keeps their types.
  const name = body.name;
  const email = body.email;
  const targetLabel = `${name} (${email})`;

  try {
    // RLS: verified target-org context — user creation + team enrollment bind to it.
    // UserService.create enforces the invite rules (passwordless ⇒ org, and a
    // cross-org teamId is rejected before any rows are written).
    const created = await withTenantAdminContext(auth.session!.user.id, organizationId, () =>
      UserService.create(
        { name, email, password, organizationId, teamId: body.teamId },
        { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' },
      )
    );

    await recordAuditLog({
      userId: auth.session!.user.id,
      action: 'user.created',
      resourceType: 'User',
      resourceId: created.id,
      organizationId,
      success: true,
    }).catch((err) => console.error('Failed to record audit log for user creation:', err));

    // Passwordless create = Google-only invite: the activation email proves
    // inbox ownership before the account's first sign-in. On failure the token
    // stays in the DB (magicLinkSent: false) — the admin resends from the row.
    let magicLinkSent = false;
    if (!password) {
      const issueResult = await issueInviteLink(created);
      // emailSent distinguishes "token in DB, no email" (SMTP blip — admin
      // resends from the user row) from a real delivery.
      magicLinkSent = issueResult.ok && issueResult.emailSent;
      await recordAuditLog({
        userId: auth.session!.user.id,
        action: 'user.invite-issued',
        resourceType: 'User',
        resourceId: created.id,
        organizationId,
        success: magicLinkSent,
      }).catch((err) => console.error('Failed to record audit log for invite issuance:', err));
    }

    await notifyUserOperation(
      'create',
      targetLabel,
      true,
      undefined,
      organizationId,
    );

    return NextResponse.json({ user: created, magicLinkSent }, { status: magicLinkSent ? 202 : 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'A user with this email already exists') {
      await notifyUserOperation('create', targetLabel, false, error.message, organizationId);
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    // Service-layer invite validation (org required for passwordless, team/org mismatch).
    if (error instanceof Error && error.name === 'ValidationError') {
      await notifyUserOperation('create', targetLabel, false, error.message, organizationId);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Failed to create user:', error);
    await notifyUserOperation('create', targetLabel, false, 'Failed to create user', organizationId);
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
  }
}
