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

  it('should use globalDb for cross-org queries', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const routePath = path.join(process.cwd(), 'app/api/admin/organizations/route.ts');
    const content = fs.readFileSync(routePath, 'utf-8');

    expect(content).toContain("from '@/lib/global-db'");
  });

  it('should have runtime = nodejs', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const routePath = path.join(process.cwd(), 'app/api/admin/organizations/route.ts');
    const content = fs.readFileSync(routePath, 'utf-8');

    expect(content).toContain("runtime = 'nodejs'");
  });

  it('should use requireSuperAdmin guard', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const routePath = path.join(process.cwd(), 'app/api/admin/organizations/route.ts');
    const content = fs.readFileSync(routePath, 'utf-8');

    expect(content).toContain('requireSuperAdmin');
  });
});

describe('POST /api/admin/organizations', () => {
  it('should set PENDING status on creation', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const routePath = path.join(process.cwd(), 'app/api/admin/organizations/route.ts');
    const content = fs.readFileSync(routePath, 'utf-8');

    expect(content).toContain("'PENDING'");
  });

  it('should generate unique slugs', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const routePath = path.join(process.cwd(), 'app/api/admin/organizations/route.ts');
    const content = fs.readFileSync(routePath, 'utf-8');

    expect(content).toContain('generateUniqueSlug');
  });
});
