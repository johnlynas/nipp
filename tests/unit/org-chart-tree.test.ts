import { describe, it, expect } from 'vitest';
import {
  buildOrgChart,
  resolvePrimaryTeamSlug,
  pickPrimaryTeamSlug,
  type BuildOrgChartInput,
  type ChartRole,
} from '@/lib/org-chart';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const roleManager: ChartRole = {
  id: 'role-1',
  name: 'Property Manager',
  permissionCount: 2,
  permissions: ['properties:read', 'properties:update'],
};

const roleAgent: ChartRole = {
  id: 'role-2',
  name: 'Letting Agent',
  permissionCount: 1,
  permissions: ['viewings:read'],
};

function makeInput(overrides: Partial<BuildOrgChartInput> = {}): BuildOrgChartInput {
  return {
    organization: { id: 'org-1', name: 'Dev Tenant Ltd', description: 'A test tenant', status: 'ACTIVE' },
    teams: [
      { id: 'team-z', slug: 'zulu', name: 'Zulu', description: null },
      { id: 'team-a', slug: 'alpha', name: 'Alpha', description: 'First team' },
    ],
    members: [
      {
        userId: 'user-1',
        name: 'Alice',
        email: 'alice@tenant.test',
        image: null,
        memberRole: 'admin',
        roles: [roleManager],
        teamSlugs: ['alpha'],
      },
      {
        userId: 'user-2',
        name: 'Bob',
        email: 'bob@tenant.test',
        image: null,
        memberRole: 'member',
        roles: [roleAgent],
        teamSlugs: ['alpha', 'zulu'], // multi-membership data — 1:1 v1 rule applies
      },
      {
        userId: 'user-3',
        name: 'Cara',
        email: 'cara@tenant.test',
        image: null,
        memberRole: 'member',
        roles: [],
        teamSlugs: [], // no team at all
      },
    ],
    viewerCanEdit: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildOrgChart
// ---------------------------------------------------------------------------

describe('buildOrgChart', () => {
  it('returns the organization and viewerCanEdit flag unchanged', () => {
    const tree = buildOrgChart(makeInput());
    expect(tree.organization).toEqual({ id: 'org-1', name: 'Dev Tenant Ltd', description: 'A test tenant', status: 'ACTIVE' });
    expect(tree.viewerCanEdit).toBe(true);
  });

  it('sorts teams alphabetically by name', () => {
    const tree = buildOrgChart(makeInput());
    expect(tree.teams.map((t) => t.name)).toEqual(['Alpha', 'Zulu']);
  });

  it('places each member under their primary (first) known team — 1:1 rule', () => {
    const tree = buildOrgChart(makeInput());
    const alpha = tree.teams.find((t) => t.slug === 'alpha');
    const zulu = tree.teams.find((t) => t.slug === 'zulu');

    expect(alpha?.members.map((m) => m.userId)).toEqual(['user-1', 'user-2']);
    // Bob is a member of zulu too, but must NOT appear under zulu (1:1 display).
    expect(zulu?.members).toEqual([]);
  });

  it('preserves assigned roles and full team slug list on the member node', () => {
    const tree = buildOrgChart(makeInput());
    const bob = tree.teams.find((t) => t.slug === 'alpha')?.members.find((m) => m.userId === 'user-2');
    expect(bob?.assignedRoles).toEqual([roleAgent]);
    expect(bob?.teams).toEqual(['alpha', 'zulu']);
  });

  it('puts members with no team membership into unassigned', () => {
    const tree = buildOrgChart(makeInput());
    expect(tree.unassigned.map((m) => m.userId)).toEqual(['user-3']);
  });

  it('ignores team slugs that do not exist for the org (falls back to unassigned)', () => {
    const tree = buildOrgChart(
      makeInput({
        members: [
          {
            userId: 'user-9',
            name: 'Dave',
            email: 'dave@tenant.test',
            image: null,
            memberRole: 'member',
            roles: [],
            teamSlugs: ['ghost-team'],
          },
        ],
      }),
    );
    expect(tree.unassigned.map((m) => m.userId)).toEqual(['user-9']);
    expect(tree.teams.every((t) => t.members.length === 0)).toBe(true);
  });

  it('sorts members alphabetically within buckets', () => {
    const input = makeInput({
      members: [
        { userId: 'u1', name: 'Zane', email: 'z@t.test', image: null, memberRole: 'member', roles: [], teamSlugs: ['alpha'] },
        { userId: 'u2', name: 'Ana', email: 'a@t.test', image: null, memberRole: 'member', roles: [], teamSlugs: ['alpha'] },
        { userId: 'u3', name: 'Milo', email: 'm@t.test', image: null, memberRole: 'member', roles: [], teamSlugs: ['alpha'] },
      ],
    });
    const tree = buildOrgChart(input);
    expect(tree.teams.find((t) => t.slug === 'alpha')?.members.map((m) => m.name)).toEqual(['Ana', 'Milo', 'Zane']);
  });

  it('handles an empty org (no teams, no members)', () => {
    const tree = buildOrgChart(makeInput({ teams: [], members: [], viewerCanEdit: false }));
    expect(tree.teams).toEqual([]);
    expect(tree.unassigned).toEqual([]);
    expect(tree.viewerCanEdit).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolvePrimaryTeamSlug
// ---------------------------------------------------------------------------

describe('resolvePrimaryTeamSlug', () => {
  it('returns the first slug that exists among the org teams', () => {
    expect(resolvePrimaryTeamSlug(['ghost', 'alpha'], new Set(['alpha', 'zulu']))).toBe('alpha');
  });

  it('returns null when the member has no matching team', () => {
    expect(resolvePrimaryTeamSlug([], new Set(['alpha']))).toBeNull();
    expect(resolvePrimaryTeamSlug(['ghost'], new Set(['alpha']))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// pickPrimaryTeamSlug (API-layer ordering rule)
// ---------------------------------------------------------------------------

describe('pickPrimaryTeamSlug', () => {
  it('prefers the earliest membership', () => {
    expect(
      pickPrimaryTeamSlug([
        { teamSlug: 'zulu', teamName: 'Zulu', createdAt: new Date('2026-01-02T00:00:00Z') },
        { teamSlug: 'alpha', teamName: 'Alpha', createdAt: new Date('2026-01-01T00:00:00Z') },
      ]),
    ).toBe('alpha');
  });

  it('breaks ties by team name (alphabetical)', () => {
    const same = new Date('2026-01-01T00:00:00Z');
    expect(
      pickPrimaryTeamSlug([
        { teamSlug: 'zulu', teamName: 'Zulu', createdAt: same },
        { teamSlug: 'alpha', teamName: 'Alpha', createdAt: same },
      ]),
    ).toBe('alpha');
  });

  it('returns null with no memberships', () => {
    expect(pickPrimaryTeamSlug([])).toBeNull();
  });
});
