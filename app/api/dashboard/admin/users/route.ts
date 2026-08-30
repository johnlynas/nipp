import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

import { UserService } from '@/services/user-service';
import { TeamService } from '@/services/team-service';
import globalDb from '@/lib/global-db';
import type { Prisma } from '@prisma/client';

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
        const matchingMembers = await globalDb.member.findMany({
          where: memberWhere,
          select: { userId: true },
        });
        userIds = matchingMembers.map((m) => m.userId);
      }

      if (teamId) {
        const teamMembers = await globalDb.teamMember.findMany({
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

    // Fetch paginated items for the table
    const result = await UserService.list(
      { search, role, organizationId, teamId, status },
      { page, pageSize },
      { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' }
    );

    // Compute counts from the full dataset using separate count queries
    const [emailVerifiedCount, bannedCount] = await Promise.all([
      globalDb.user.count({ where: { ...where, emailVerified: true } }),
      globalDb.user.count({ where: { ...where, banned: true } }),
    ]);

    return NextResponse.json({
      ...result,
      counts: {
        emailVerifiedCount,
        bannedCount,
        activeCount: result.pagination.total - bannedCount,
      },
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

  try {
    // Rate limit write operations by session
    if (!checkAdminRateLimit(auth.session!.user.id)) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }

    const body = await request.json();
    const organizationId = body.organizationId;

    if (!organizationId) {
      return NextResponse.json({ error: 'Organization is required' }, { status: 400 });
    }

    const result = await UserService.create(body, {
      userId: auth.session!.user.id,
      role: 'PLATFORM_ADMIN',
    });

    // Auto-add user to the "Members" team in their organization
    const membersTeam = await globalDb.team.findFirst({
      where: { organizationId, slug: 'members' },
    });

    if (membersTeam) {
      try {
        await TeamService.addTeamMember(membersTeam.id, { userId: result.id }, {
          userId: auth.session!.user.id,
          role: 'PLATFORM_ADMIN',
        });
      } catch (err) {
        // Ignore if user is already a member of this team
        console.warn('User may already be a team member:', err);
      }
    } else {
      console.warn('Members team not found for organization', organizationId);
    }

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'A user with this email already exists') {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error('Failed to create user:', error);
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
  }
}
