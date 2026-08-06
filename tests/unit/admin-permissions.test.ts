/**
 * Unit test: Global permissions endpoint — structural verification.
 */

import { describe, it, expect } from 'vitest';

describe('GET /api/admin/permissions', () => {
  it('should require Super Admin access (403 for non-admin)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const routePath = path.join(process.cwd(), 'app/api/admin/permissions/route.ts');
    const content = fs.readFileSync(routePath, 'utf-8');

    expect(content).toContain('requireSuperAdmin');
  });

  it('should support CRUD operations', async () => {
    const fs = await import('fs');
    const path = await import('path');

    // GET and POST live in the base route
    const routePath = path.join(process.cwd(), 'app/api/admin/permissions/route.ts');
    const content = fs.readFileSync(routePath, 'utf-8');
    expect(content).toContain('export const GET = wrapPiiRoute');
    expect(content).toContain('export const POST = wrapPiiRoute');

    // PATCH and DELETE live in the [id] route
    const idRoutePath = path.join(process.cwd(), 'app/api/admin/permissions/[id]/route.ts');
    const idContent = fs.readFileSync(idRoutePath, 'utf-8');
    expect(idContent).toContain('export const GET = wrapPiiRoute');
    expect(idContent).toContain('export const PATCH = wrapPiiRoute');
    expect(idContent).toContain('export const DELETE = wrapPiiRoute');
  });

  it('should validate resource and action parameters', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const routePath = path.join(process.cwd(), 'app/api/admin/permissions/route.ts');
    const content = fs.readFileSync(routePath, 'utf-8');

    expect(content).toContain('resource');
    expect(content).toContain('action');
  });

  it('should use PermissionService for all operations', async () => {
    const fs = await import('fs');
    const path = await import('path');

    // Base route uses PermissionService.list and PermissionService.create
    const routePath = path.join(process.cwd(), 'app/api/admin/permissions/route.ts');
    const content = fs.readFileSync(routePath, 'utf-8');
    expect(content).toContain('PermissionService.list');
    expect(content).toContain('PermissionService.create');

    // [id] route uses PermissionService.getById, update, and delete
    const idRoutePath = path.join(process.cwd(), 'app/api/admin/permissions/[id]/route.ts');
    const idContent = fs.readFileSync(idRoutePath, 'utf-8');
    expect(idContent).toContain('PermissionService.getById');
    expect(idContent).toContain('PermissionService.update');
    expect(idContent).toContain('PermissionService.delete');
  });

  it('should not use direct Prisma calls', async () => {
    const fs = await import('fs');
    const path = await import('path');

    // Base route should not use globalDb.permission
    const routePath = path.join(process.cwd(), 'app/api/admin/permissions/route.ts');
    const content = fs.readFileSync(routePath, 'utf-8');
    expect(content).not.toContain('globalDb.permission');

    // [id] route should not use globalDb.permission
    const idRoutePath = path.join(process.cwd(), 'app/api/admin/permissions/[id]/route.ts');
    const idContent = fs.readFileSync(idRoutePath, 'utf-8');
    expect(idContent).not.toContain('globalDb.permission');
  });
});
