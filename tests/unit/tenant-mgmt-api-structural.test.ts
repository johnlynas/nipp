/**
 * Structural verification of all super admin tenant management API routes.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

function readRoute(relativePath: string): string {
  const routePath = path.join(process.cwd(), relativePath);
  return fs.readFileSync(routePath, 'utf-8');
}

describe('Tenant Management API — Structural Verification', () => {
  describe('Members route (GET/POST)', () => {
    const content = readRoute('app/api/admin/organizations/[orgId]/members/route.ts');

    it('should export GET and POST handlers', () => {
      expect(content).toContain('export const GET = wrapPiiRoute');
      expect(content).toContain('export const POST = wrapPiiRoute');
    });

    it('should use requireSuperAdmin guard', () => {
      expect(content).toContain('requireSuperAdmin');
    });

    it('should validate email in POST body', () => {
      expect(content).toContain("'Email is required'");
    });

    it('should use globalDb for cross-org lookups', () => {
      expect(content).toContain('globalDb.organization.findUnique');
    });

    it('should use runWithTenant for scoped operations', () => {
      expect(content).toContain('runWithTenant');
    });

    it('should use tenantDb within tenant context', () => {
      expect(content).toContain('tenantDb.member');
    });

    it('should record audit log on member creation', () => {
      expect(content).toContain("recordAuditLog");
      expect(content).toContain("'member.created'");
    });

    it('should handle database unavailable with 503', () => {
      expect(content).toContain("'Database unavailable'");
    });

    it('should return 409 for duplicate member', () => {
      expect(content).toContain("'User is already a member of this organization'");
    });

    it('should set runtime to nodejs', () => {
      expect(content).toContain("runtime = 'nodejs'");
    });
  });

  describe('Members detail route (PATCH/DELETE)', () => {
    const content = readRoute(
      'app/api/admin/organizations/[orgId]/members/[memberId]/route.ts'
    );

    it('should export PATCH and DELETE handlers', () => {
      expect(content).toContain('export const PATCH = wrapPiiRoute');
      expect(content).toContain('export const DELETE = wrapPiiRoute');
    });

    it('should use requireSuperAdmin guard', () => {
      expect(content).toContain('requireSuperAdmin');
    });

    it('should validate role in PATCH body', () => {
      expect(content).toContain("'Role is required'");
    });

    it('should use globalDb for cross-org lookups', () => {
      expect(content).toContain('globalDb.organization.findUnique');
    });

    it('should use runWithTenant for scoped operations', () => {
      expect(content).toContain('runWithTenant');
    });

    it('should record audit log on role update', () => {
      expect(content).toContain("recordAuditLog");
      expect(content).toContain("'member.role_updated'");
    });

    it('should record audit log on member deletion', () => {
      expect(content).toContain("'member.deleted'");
    });

    it('should handle database unavailable with 503', () => {
      expect(content).toContain("'Database unavailable'");
    });

    it('should return 404 for member not found in org', () => {
      expect(content).toContain("'Member not found in this organization'");
    });

    it('should set runtime to nodejs', () => {
      expect(content).toContain("runtime = 'nodejs'");
    });
  });

  describe('Roles route (GET/POST)', () => {
    const content = readRoute('app/api/admin/organizations/[orgId]/roles/route.ts');

    it('should export GET and POST handlers', () => {
      expect(content).toContain('export async function GET');
      expect(content).toContain('export async function POST');
    });

    it('should use requireSuperAdmin guard', () => {
      expect(content).toContain('requireSuperAdmin');
    });

    it('should validate name in POST body', () => {
      expect(content).toContain("'Role name is required'");
    });

    it('should use globalDb for cross-org lookups', () => {
      expect(content).toContain('globalDb.organization.findUnique');
    });

    it('should use runWithTenant for scoped operations', () => {
      expect(content).toContain('runWithTenant');
    });

    it('should check for duplicate role name', () => {
      expect(content).toContain("'A role with this name already exists in this organization'");
    });

    it('should record audit log on role creation', () => {
      expect(content).toContain("recordAuditLog");
      expect(content).toContain("'role.created'");
    });

    it('should handle database unavailable with 503', () => {
      expect(content).toContain("'Database unavailable'");
    });

    it('should set runtime to nodejs', () => {
      expect(content).toContain("runtime = 'nodejs'");
    });

    it('should include role permissions in GET response', () => {
      expect(content).toContain("permissions: { include: { permission: true } }");
    });

    it('should include member count in GET response', () => {
      expect(content).toContain('_count');
    });
  });

  describe('Roles detail route (PATCH/DELETE)', () => {
    const content = readRoute(
      'app/api/admin/organizations/[orgId]/roles/[roleId]/route.ts'
    );

    it('should export PATCH and DELETE handlers', () => {
      expect(content).toContain('export async function PATCH');
      expect(content).toContain('export async function DELETE');
    });

    it('should use requireSuperAdmin guard', () => {
      expect(content).toContain('requireSuperAdmin');
    });

    it('should validate name or description in PATCH body', () => {
      expect(content).toContain("'Provide name or description to update'");
    });

    it('should use globalDb for cross-org lookups', () => {
      expect(content).toContain('globalDb.organization.findUnique');
    });

    it('should use runWithTenant for scoped operations', () => {
      expect(content).toContain('runWithTenant');
    });

    it('should check member count before role deletion', () => {
      expect(content).toContain('memberRole.count');
    });

    it('should return 400 when role has assigned members', () => {
      expect(content).toContain('Cannot delete role with');
    });

    it('should record audit log on role update', () => {
      expect(content).toContain("recordAuditLog");
      expect(content).toContain("'role.updated'");
    });

    it('should record audit log on role deletion', () => {
      expect(content).toContain("'role.deleted'");
    });

    it('should handle database unavailable with 503', () => {
      expect(content).toContain("'Database unavailable'");
    });

    it('should set runtime to nodejs', () => {
      expect(content).toContain("runtime = 'nodejs'");
    });
  });

  describe('Permissions route (GET/PATCH)', () => {
    const content = readRoute(
      'app/api/admin/organizations/[orgId]/permissions/route.ts'
    );

    it('should export GET and PATCH handlers', () => {
      expect(content).toContain('export async function GET');
      expect(content).toContain('export async function PATCH');
    });

    it('should use requireSuperAdmin guard', () => {
      expect(content).toContain('requireSuperAdmin');
    });

    it('should validate assignments array in PATCH body', () => {
      expect(content).toContain("'Assignments array is required'");
    });

    it('should use globalDb for cross-org lookups', () => {
      expect(content).toContain('globalDb.organization.findUnique');
    });

    it('should use runWithTenant for scoped operations', () => {
      expect(content).toContain('runWithTenant');
    });

    it('should build permission grid in GET response', () => {
      expect(content).toContain('rolePermissionMap');
    });

    it('should handle partial failures in PATCH (invalid role/perm)', () => {
      expect(content).toContain('success: false');
    });

    it('should record audit log on permission changes', () => {
      expect(content).toContain("recordAuditLog");
      expect(content).toContain("'permissions.updated'");
    });

    it('should handle database unavailable with 503', () => {
      expect(content).toContain("'Database unavailable'");
    });

    it('should set runtime to nodejs', () => {
      expect(content).toContain("runtime = 'nodejs'");
    });

    it('should revalidate cache on permission changes', () => {
      expect(content).toContain("revalidateTag('org')");
    });
  });

  describe('Settings route (PATCH)', () => {
    const content = readRoute(
      'app/api/admin/organizations/[orgId]/settings/route.ts'
    );

    it('should export PATCH handler', () => {
      expect(content).toContain('export const PATCH = wrapPiiRoute');
    });

    it('should use auth guard for authorization', () => {
      expect(content).toContain('requireSuperAdmin');
    });

    it('should validate at least one field in PATCH body', () => {
      expect(content).toContain("'Provide name, slug, or status to update'");
    });

    it('should validate status transitions (state machine)', () => {
      expect(content).toContain("VALID_TRANSITIONS");
    });

    it('should invalidate sessions on SUSPENDED status', () => {
      expect(content).toContain("'SUSPENDED'");
      expect(content).toContain('session.deleteMany');
    });

    it('should validate slug uniqueness', () => {
      expect(content).toContain("'Slug already in use by another organization'");
    });

    it('should record audit log on settings update', () => {
      expect(content).toContain("recordAuditLog");
      expect(content).toContain("'organization.settings_updated'");
    });

    it('should handle database unavailable with 503', () => {
      expect(content).toContain("'Database unavailable'");
    });

    it('should set runtime to nodejs', () => {
      expect(content).toContain("runtime = 'nodejs'");
    });

    it('should use globalDb for organization updates', () => {
      expect(content).toContain('globalDb.organization.update');
    });
  });

  describe('All routes use consistent patterns', () => {
    const routeFiles = [
      'app/api/admin/organizations/[orgId]/members/route.ts',
      'app/api/admin/organizations/[orgId]/members/[memberId]/route.ts',
      'app/api/admin/organizations/[orgId]/roles/route.ts',
      'app/api/admin/organizations/[orgId]/roles/[roleId]/route.ts',
      'app/api/admin/organizations/[orgId]/permissions/route.ts',
      'app/api/admin/organizations/[orgId]/settings/route.ts',
    ];

    it('all routes should use an auth guard', () => {
      for (const file of routeFiles) {
        const content = readRoute(file);
        // Accept either requireSuperAdmin or direct auth.api.getSession
        const hasGuard = content.includes('requireSuperAdmin') ||
                         content.includes('auth.api.getSession');
        expect(hasGuard).toBe(true);
      }
    });

    it('all routes should set runtime to nodejs', () => {
      for (const file of routeFiles) {
        const content = readRoute(file);
        expect(content).toContain("runtime = 'nodejs'");
      }
    });

    it('all routes should handle database unavailable with 503', () => {
      for (const file of routeFiles) {
        const content = readRoute(file);
        expect(content).toContain("'Database unavailable'");
      }
    });

    it('all routes should use globalDb for cross-org lookups', () => {
      for (const file of routeFiles) {
        const content = readRoute(file);
        expect(content).toContain('globalDb.organization.findUnique');
      }
    });

    it('all routes should import logger', () => {
      for (const file of routeFiles) {
        const content = readRoute(file);
        expect(content).toContain("from '@/lib/logger'");
      }
    });
  });
});
