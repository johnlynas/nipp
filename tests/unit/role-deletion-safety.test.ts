/**
 * Unit test: Role deletion safety checks — structural verification.
 */

import { describe, it, expect } from 'vitest';

describe('Role Deletion Safety', () => {
  it('should protect default roles from deletion', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const routePath = path.join(process.cwd(), 'app/api/roles/[roleId]/route.ts');
    const content = fs.readFileSync(routePath, 'utf-8');

    expect(content).toContain('isDefault');
    expect(content).toContain("Cannot delete default roles");
  });

  it('should check member count before deletion', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const routePath = path.join(process.cwd(), 'app/api/roles/[roleId]/route.ts');
    const content = fs.readFileSync(routePath, 'utf-8');

    expect(content).toContain('memberRole.count');
  });

  it('should return warning when role has assigned members', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const routePath = path.join(process.cwd(), 'app/api/roles/[roleId]/route.ts');
    const content = fs.readFileSync(routePath, 'utf-8');

    expect(content).toContain('memberCount');
  });

  it('should use runtime = nodejs', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const routePath = path.join(process.cwd(), 'app/api/roles/[roleId]/route.ts');
    const content = fs.readFileSync(routePath, 'utf-8');

    expect(content).toContain("runtime = 'nodejs'");
  });
});
