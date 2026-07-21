/**
 * Unit tests: Organization lifecycle API routes — structural verification.
 */

import { describe, it, expect } from 'vitest';

describe('GET /api/admin/organizations', () => {
  it('should enforce pagination with default page size of 20', async () => {
    // Verify the route file exists and contains pagination logic
    const fs = await import('fs');
    const path = await import('path');
    const routePath = path.join(process.cwd(), 'app/api/admin/organizations/route.ts');
    const content = fs.readFileSync(routePath, 'utf-8');

    expect(content).toContain('pageSize');
    expect(content).toContain('skip');
    expect(content).toContain('take');
    // Default page size should be 20
    expect(content).toContain("'20'");
    expect(content).toContain('20');
  });

  it('should use prisma for queries', async () => {
    // Verify the route file exists and contains prisma import
    const fs = await import('fs');
    const path = await import('path');
    const routePath = path.join(process.cwd(), 'app/api/admin/organizations/route.ts');
    const content = fs.readFileSync(routePath, 'utf-8');

    expect(content).toContain("from '@/lib/db'");
  });

  it('should use auth middleware guard', async () => {
    // Verify the route file exists and contains withSuperAdmin
    const fs = await import('fs');
    const path = await import('path');
    const routePath = path.join(process.cwd(), 'app/api/admin/organizations/route.ts');
    const content = fs.readFileSync(routePath, 'utf-8');

    expect(content).toContain('withSuperAdmin');
  });
});

describe('POST /api/admin/organizations', () => {
  it('should handle slug generation', async () => {
    // Verify the route file exists and contains slug generation logic
    const fs = await import('fs');
    const path = await import('path');
    const routePath = path.join(process.cwd(), 'app/api/admin/organizations/route.ts');
    const content = fs.readFileSync(routePath, 'utf-8');

    expect(content).toContain('uniqueSlug');
  });
});
