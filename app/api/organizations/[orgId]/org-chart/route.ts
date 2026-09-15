/**
 * Org chart read endpoint.
 *
 * GET /api/organizations/[orgId]/org-chart — returns the full org tree
 * (organization → teams → members) with per-member roles and permissions.
 *
 * Authorization (mirrors the calendar routes):
 *   - membership OR super admin via resolveTenantAccess (401 / 403 / 503)
 *   - viewerCanEdit = true for PLATFORM_ADMIN or TENANT_ADMIN
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import globalDb from '@/lib/global-db';
import { superAdminStorage } from '@/lib/global-db-guard';
import { resolveTenantAccess } from '@/lib/tenant-access';
import {
  buildOrgChart,
  type BuildOrgChartInput,
  type ChartRole,
} from '@/lib/org-chart';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// GET — full org chart tree
// ---------------------------------------------------------------------------

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = (await params).orgId;

  // Membership OR super admin (platform super admin can view any tenant's chart)
  const access = await resolveTenantAccess(req, session.user.id, orgId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const viewerCanEdit =
    access.ctx.role === 'PLATFORM_ADMIN' || access.ctx.role === 'TENANT_ADMIN';

  try {
    // One org-scoped read (S7: wrap the unscoped client in superAdminStorage so
    // the AsyncLocalStorage context does not leak, same as the calendar routes).
    const org = await superAdminStorage.run(true, () =>
      globalDb.organization.findUnique({
        where: { id: orgId },
        include: {
          teams: {
            include: {
              members: {
                include: {
                  user: { select: { id: true, name: true, email: true, image: true } },
                },
              },
            },
          },
          members: {
            include: {
              user: { select: { id: true, name: true, email: true, image: true } },
              memberRoles: {
                include: {
                  role: {
                    select: {
                      id: true,
                      name: true,
                      permissions: {
                        select: { permission: { select: { key: true } } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      })
    );

    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Map userId -> their TeamMember rows (all teams in this org).
    const membershipsByUser = new Map<
      string,
      { teamSlug: string; teamName: string; createdAt: Date }[]
    >();
    for (const team of org.teams) {
      for (const tm of team.members) {
        const list = membershipsByUser.get(tm.userId) ?? [];
        list.push({ teamSlug: team.slug ?? '', teamName: team.name, createdAt: tm.createdAt });
        membershipsByUser.set(tm.userId, list);
      }
    }

    // BuildChartInput.members — one entry per org member (Member rows are the
    // authoritative membership list). teamSlugs ordered primary-first:
    // earliest createdAt wins, ties broken by team name (1:1 v1 rule — the
    // shaper renders the member under the FIRST slug it knows).
    const members: BuildOrgChartInput['members'] = [];
    const seen = new Set<string>();
    for (const member of org.members) {
      if (seen.has(member.userId)) continue;
      seen.add(member.userId);

      const memberships = (membershipsByUser.get(member.userId) ?? []).slice().sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() ||
          a.teamName.localeCompare(b.teamName),
      );

      const roles: ChartRole[] = member.memberRoles.map((mr) => ({
        id: mr.role.id,
        name: mr.role.name,
        permissionCount: mr.role.permissions.length,
        permissions: mr.role.permissions.map((rp) => rp.permission.key),
      }));

      members.push({
        userId: member.userId,
        name: member.user.name,
        email: member.user.email,
        image: member.user.image,
        memberRole: member.role,
        roles,
        teamSlugs: memberships.map((m) => m.teamSlug).filter((s) => s.length > 0),
      });
    }

    const input: BuildOrgChartInput = {
      organization: {
        id: org.id,
        name: org.name,
        description: org.description,
      },
      teams: org.teams.map((team) => ({
        id: team.id,
        slug: team.slug ?? '',
        name: team.name,
        description: team.description,
      })),
      members,
      viewerCanEdit,
    };

    return NextResponse.json(buildOrgChart(input));
  } catch (error: unknown) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
