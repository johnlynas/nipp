import { describe, it, expect } from 'vitest';
import { buildRLSContextQueries } from '@/lib/rls-context';

describe('buildRLSContextQueries', () => {
  it('emits a single query that sets the three GUCs as transaction-local', () => {
    const q = buildRLSContextQueries({ userId: 'u1', orgId: 'org-A', isPlatformAdmin: true });
    expect(q).toContain("set_config('app.current_user_id'");
    expect(q).toContain("set_config('app.current_org_id'");
    expect(q).toContain("set_config('app.is_platform_admin'");
    // transaction-scoped (third arg true) on every set_config call
    expect(q.match(/, true\)/g)).toHaveLength(3);
  });

  it('encodes isPlatformAdmin as 1/0', () => {
    expect(buildRLSContextQueries({ userId: 'u1', orgId: 'org-A', isPlatformAdmin: true })).toContain("'1'");
    expect(buildRLSContextQueries({ userId: 'u1', orgId: 'org-A', isPlatformAdmin: false })).toContain("'0'");
  });

  it('escapes single quotes in identifiers by doubling (defensive)', () => {
    const q = buildRLSContextQueries({ userId: "o'brien", orgId: "org 'A'", isPlatformAdmin: false });
    expect(q).toContain("'o''brien'");
    expect(q).toContain("'org ''A''");
  });

  it('omits app.platform_org_id for ordinary (non-job) contexts', () => {
    const q = buildRLSContextQueries({ userId: 'u1', orgId: 'org-A', isPlatformAdmin: false });
    expect(q).not.toContain('app.platform_org_id');
  });

  it('sets app.platform_org_id transaction-locally when provided (job tables)', () => {
    const q = buildRLSContextQueries({ userId: 'u1', orgId: 'org-A', isPlatformAdmin: true, platformOrgId: 'pltf' });
    expect(q).toContain("set_config('app.platform_org_id', 'pltf', true)");
    expect(q.match(/, true\)/g)).toHaveLength(4);
  });

  it('treats empty-string platformOrgId as omitted', () => {
    const q = buildRLSContextQueries({ userId: 'u1', orgId: 'org-A', isPlatformAdmin: true, platformOrgId: '' });
    expect(q).not.toContain('app.platform_org_id');
  });
});
