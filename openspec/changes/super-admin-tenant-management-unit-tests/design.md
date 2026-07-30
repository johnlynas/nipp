# Design: Super Admin Tenant Management — Unit Tests

## Overview

This document describes the technical design for unit tests covering the super admin tenant management feature. Tests are organized into four categories: structural, mocked handler, UI component, and state machine tests.

## Test Organization

```
tests/unit/
├── tenant-mgmt-api-structural.test.ts    # Structural verification of all routes
├── tenant-mgmt-members.test.ts           # Mocked members API tests
├── tenant-mgmt-roles.test.ts             # Mocked roles API tests
├── tenant-mgmt-permissions.test.ts       # Mocked permissions API tests
├── tenant-mgmt-settings.test.ts          # Mocked settings API tests
├── TenantMemberForm.test.tsx             # UI component tests
├── TenantRoleForm.test.tsx               # UI component tests
└── org-state-machine.test.ts             # Extended state machine tests (modified)
```

## Mocking Strategy

### Global DB Mock

All API routes use `globalDb` for cross-org lookups (organization existence, user lookup). We mock this at the module level:

```typescript
vi.mock('@/lib/global-db', () => ({
  default: {
    organization: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    user: { findUnique: vi.fn(), create: vi.fn() },
    member: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    role: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    rolePermission: { findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    session: { deleteMany: vi.fn() },
    memberRole: { count: vi.fn() },
  },
}));
```

### Tenant DB Mock

All API routes use `tenantDb` within `runWithTenant()` for scoped operations. We mock this similarly:

```typescript
vi.mock('@/lib/tenant-db', () => ({
  default: {
    member: { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    role: { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    rolePermission: { findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  },
}));
```

### Tenant Context Mock

`runWithTenant()` is mocked to execute the callback directly, passing through the orgId:

```typescript
vi.mock('@/lib/tenant-context', () => ({
  runWithTenant: vi.fn(async (orgId: string, fn: () => Promise<unknown>) => fn()),
}));
```

### Auth Guard Mock

`requireSuperAdmin()` is mocked to return either authorized or unauthorized:

```typescript
vi.mock('@/lib/require-super-admin', () => ({
  requireSuperAdmin: vi.fn(),
}));
```

### Audit Log Mock

`recordAuditLog()` is mocked to do nothing (we verify it's called, not its internals):

```typescript
vi.mock('@/lib/audit-log', () => ({
  recordAuditLog: vi.fn().mockResolvedValue(undefined),
}));
```

### Logger Mock

`logger` is mocked to suppress console output during tests:

```typescript
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
```

## Test Patterns

### Structural Tests Pattern

Read source file, verify exports and patterns:

```typescript
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('GET /api/admin/organizations/[orgId]/members', () => {
  it('should export GET and POST handlers', async () => {
    const routePath = path.join(process.cwd(), 'app/api/admin/organizations/[orgId]/members/route.ts');
    const content = fs.readFileSync(routePath, 'utf-8');
    
    expect(content).toContain('export async function GET');
    expect(content).toContain('export async function POST');
  });

  it('should use requireSuperAdmin guard', () => {
    expect(content).toContain('requireSuperAdmin');
  });

  it('should validate email in POST body', () => {
    expect(content).toContain("'Email is required'");
  });
});
```

### Mocked Handler Tests Pattern

Import the route module after mocking dependencies:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all dependencies first
vi.mock('@/lib/require-super-admin', () => ({
  requireSuperAdmin: vi.fn(),
}));

// Then import the route (uses mocked dependencies)
const { GET, POST } = await import('@/app/api/admin/organizations/[orgId]/members/route');

describe('GET /api/admin/organizations/[orgId]/members', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should return members when authorized', async () => {
    // Arrange
    vi.mocked(requireSuperAdmin).mockResolvedValue({ authorized: true, session: { user: { id: 'admin-1', name: 'Admin' } } });
    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1' });
    vi.mocked(tenantDb.member.findMany).mockResolvedValue([]);

    // Act
    const response = await GET({} as NextRequest, { params: Promise.resolve({ orgId: 'org-1' }) });

    // Assert
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.members).toEqual([]);
  });

  it('should return 403 when not authorized', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({ authorized: false, error: 'Unauthorized' });

    const response = await GET({} as NextRequest, { params: Promise.resolve({ orgId: 'org-1' }) });

    expect(response.status).toBe(403);
  });
});
```

### UI Component Tests Pattern

Use Testing Library with jsdom:

```typescript
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

describe('TenantMemberForm', () => {
  it('renders form fields correctly', () => {
    render(<TenantMemberForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/role/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add member/i })).toBeInTheDocument();
  });

  it('calls onSubmit with form data when submitted', async () => {
    const onSubmit = vi.fn();
    render(<TenantMemberForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /add member/i }));

    expect(onSubmit).toHaveBeenCalledWith({ email: 'user@example.com', role: 'member' });
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<TenantMemberForm onSubmit={vi.fn()} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('disables submit button while submitting', async () => {
    const onSubmit = vi.fn(() => new Promise(resolve => setTimeout(resolve, 100)));
    render(<TenantMemberForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /add member/i }));

    expect(screen.getByRole('button', { name: /adding\.\.\./i })).toBeDisabled();
  });
});
```

## Error Handling Coverage Matrix

Each handler must be tested for these error conditions:

| Handler | 403 (Auth) | 400 (Validation) | 404 (Not Found) | 409 (Conflict) | 503 (DB Unavailable) |
|---------|-----------|------------------|-----------------|----------------|---------------------|
| GET members | ✓ | — | ✓ (org) | — | ✓ |
| POST members | ✓ | ✓ (email) | ✓ (org, user) | ✓ (duplicate member) | ✓ |
| PATCH member | ✓ | ✓ (role) | ✓ (org, member) | — | ✓ |
| DELETE member | ✓ | — | ✓ (org, member) | — | ✓ |
| GET roles | ✓ | — | ✓ (org) | — | ✓ |
| POST roles | ✓ | ✓ (name) | ✓ (org) | ✓ (duplicate role) | ✓ |
| PATCH role | ✓ | ✓ (name/desc) | ✓ (org, role) | — | ✓ |
| DELETE role | ✓ | — | ✓ (org, role) | ✓ (in use) | ✓ |
| GET permissions | ✓ | — | ✓ (org) | — | ✓ |
| PATCH permissions | ✓ | ✓ (assignments) | ✓ (org, role, perm) | — | ✓ |
| PATCH settings | ✓ | ✓ (name/slug/status) | ✓ (org) | ✓ (slug collision) | ✓ |

## Design Token Verification

UI component tests verify:
- Header text uses Navy (`#1B2A4A`) — check `style={{ color: '#1B2A4A' }}`
- Submit buttons use Amber (`#F5A623`) — check `style={{ backgroundColor: '#F5A623' }}`
- Focus states use Amber (`#F5A623`) — check `focus:border-[#F5A623]`

## Test Execution

All tests run via Vitest:

```bash
# Run all unit tests (including new tenant management tests)
npm test

# Run only tenant management tests
npx vitest run tests/unit/tenant-mgmt-*.test.ts

# Run only UI component tests
npx vitest run tests/unit/TenantMemberForm.test.tsx tests/unit/TenantRoleForm.test.tsx

# Run with coverage
npx vitest run --coverage tests/unit/tenant-mgmt-*.test.ts
```

Expected total test time: < 10 seconds for all new tests.
