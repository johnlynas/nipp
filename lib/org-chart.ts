/**
 * Org chart tree shaper — pure functions only (no DB, no Next.js imports).
 *
 * The API route (app/api/organizations/[orgId]/org-chart/route.ts) reads
 * Prisma rows, flattens them into `BuildOrgChartInput`, and hands the result
 * to `buildOrgChart` to produce the JSON tree rendered by
 * components/org-chart/OrgChart.tsx.
 *
 * v1 rules (see documents/feature-planning-and-development/interactive-org-chart.md):
 *   - Chart depth: organization → teams → members.
 *   - 1:1 team–member display: each member renders under exactly one team.
 *     A member's `teamSlugs` is ordered by the API layer (primary
 *     membership first: earliest createdAt, ties broken by team name); the
 *     shaper places the member under the FIRST slug that matches a known
 *     team, and puts members with no usable team into `unassigned`.
 */

// ---------------------------------------------------------------------------
// Output types (shared with components/org-chart/types.ts)
// ---------------------------------------------------------------------------

export interface ChartRole {
  id: string;
  name: string;
  permissionCount: number;
  /** Permission keys (resource:action) granted through this role. */
  permissions: string[];
}

export interface ChartMember {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  /** BetterAuth membership role (e.g. "admin", "member"). */
  memberRole: string;
  assignedRoles: ChartRole[];
  /** Slugs of the teams the member belongs to (primary first). */
  teams: string[];
}

export interface ChartTeam {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  members: ChartMember[];
}

export interface ChartOrganization {
  id: string;
  name: string;
  description: string | null;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
}

export interface ChartTree {
  organization: ChartOrganization;
  teams: ChartTeam[];
  /** Org members with no team membership. */
  unassigned: ChartMember[];
  /** Super admin or tenant admin of the organization being viewed. */
  viewerCanEdit: boolean;
}

// ---------------------------------------------------------------------------
// Input types (flattened from Prisma rows by the route)
// ---------------------------------------------------------------------------

export interface BuildOrgChartInput {
  organization: ChartOrganization;
  teams: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
  }[];
  members: {
    userId: string;
    name: string;
    email: string;
    image: string | null;
    memberRole: string;
    roles: ChartRole[];
    /** Ordered — the first slug is the member's primary team (see header). */
    teamSlugs: string[];
  }[];
  viewerCanEdit: boolean;
}

// ---------------------------------------------------------------------------
// Shape helpers
// ---------------------------------------------------------------------------

/**
 * Place a member under their primary known team.
 * Returns the team slug, or null if none of the member's team slugs exist
 * among the org's teams (or the member has no memberships at all).
 */
export function resolvePrimaryTeamSlug(
  teamSlugs: string[],
  availableTeamSlugs: Set<string>,
): string | null {
  for (const slug of teamSlugs) {
    if (availableTeamSlugs.has(slug)) return slug;
  }
  return null;
}

/** Flatten one member row into the public `ChartMember` shape. */
export function toChartMember(member: BuildOrgChartInput['members'][number]): ChartMember {
  return {
    userId: member.userId,
    name: member.name,
    email: member.email,
    image: member.image,
    memberRole: member.memberRole,
    assignedRoles: member.roles,
    teams: member.teamSlugs,
  };
}

/**
 * Build the final org chart tree.
 *
 * Guarantees:
 *   - Teams are returned alphabetically by name.
 *   - Each member appears under at most one team (1:1 v1 rule).
 *   - Members with no known team land in `unassigned`.
 *   - Members with no team are alphabetical by name; team members too.
 */
export function buildOrgChart(input: BuildOrgChartInput): ChartTree {
  const teams = [...input.teams].sort((a, b) => a.name.localeCompare(b.name));
  const availableSlugs = new Set(teams.map((t) => t.slug));

  const buckets = new Map<string, ChartMember[]>();
  const unassigned: ChartMember[] = [];

  for (const member of input.members) {
    const primary = resolvePrimaryTeamSlug(member.teamSlugs, availableSlugs);
    const chartMember = toChartMember(member);
    if (primary === null) {
      unassigned.push(chartMember);
    } else {
      const list = buckets.get(primary) ?? [];
      list.push(chartMember);
      buckets.set(primary, list);
    }
  }

  const byName = (a: ChartMember, b: ChartMember) => a.name.localeCompare(b.name);
  unassigned.sort(byName);

  const chartTeams: ChartTeam[] = teams.map((team) => ({
    id: team.id,
    slug: team.slug,
    name: team.name,
    description: team.description,
    members: (buckets.get(team.slug) ?? []).sort(byName),
  }));

  return {
    organization: input.organization,
    teams: chartTeams,
    unassigned,
    viewerCanEdit: input.viewerCanEdit,
  };
}

/**
 * Resolve a member's primary team slug: earliest createdAt membership wins,
 * ties broken by team name (alphabetical). Returns the slug, or null when the
 * member has no team membership.
 *
 * Pure helper kept here so the unit tests exercise the API-layer ordering
 * logic as well as the tree build.
 */
export function pickPrimaryTeamSlug(
  memberships: { teamSlug: string; teamName: string; createdAt: Date }[],
): string | null {
  const sorted = [...memberships].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.teamName.localeCompare(b.teamName),
  );
  return sorted.length > 0 ? sorted[0].teamSlug : null;
}
