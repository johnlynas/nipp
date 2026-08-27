/** 
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { UseQueryResult } from '@tanstack/react-query';

// --- Mock Setup ---
vi.mock('@/features/permissions/api/usePermissions', () => ({
  useHasPermission: vi.fn(),
  useHasAnyPermission: vi.fn(),
  useUserRoles: vi.fn(),
}));

import * as PermissionsAPI from '@/features/permissions/api/usePermissions';
import { RequiredPermissions, HasAnyPermission, RoleGuard } from '@/features/permissions';

// Wrap with vi.mocked() so TypeScript knows these are mocks
const mockUseHasPermission = vi.mocked(PermissionsAPI.useHasPermission);
const mockUseHasAnyPermission = vi.mocked(PermissionsAPI.useHasAnyPermission);
const mockUseUserRoles = vi.mocked(PermissionsAPI.useUserRoles);

// Helper to shape mock data into the UseQueryResult shape the hook expects.
function roles(data: string[] | null, isLoading = false): UseQueryResult<string[]> {
  return { data, isLoading } as unknown as UseQueryResult<string[]>;
}

// ========================================================================
// REQUIRED PERMISSIONS (AND LOGIC)
// ========================================================================

describe('RequiredPermissions (AND Logic)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const TestContent = <div data-testid="secret-content">Secret Admin Area</div>;

  it('renders children when the user has all required permissions', () => {
    mockUseHasPermission.mockReturnValue(true);

    render(
      <RequiredPermissions permission="org:manage">
        {TestContent}
      </RequiredPermissions>
    );

    expect(screen.getByTestId('secret-content')).toBeInTheDocument();
  });

  it('does NOT render children when the user is denied', () => {
    mockUseHasPermission.mockReturnValue(false);

    render(
      <RequiredPermissions permission="org:manage">
        {TestContent}
      </RequiredPermissions>
    );

    expect(screen.queryByTestId('secret-content')).not.toBeInTheDocument();
  });

  it('does not flash the UI while fetching permissions (Prevents FOUC)', () => {
    mockUseHasPermission.mockReturnValue(undefined);

    const { rerender } = render(
      <RequiredPermissions permission="org:manage">
        {TestContent}
      </RequiredPermissions>
    );

    expect(screen.queryByTestId('secret-content')).not.toBeInTheDocument();

    mockUseHasPermission.mockReturnValue(true);

    rerender(
      <RequiredPermissions permission="org:manage">
        {TestContent}
      </RequiredPermissions>
    );

    expect(screen.getByTestId('secret-content')).toBeInTheDocument();
  });

  it('requires all permissions in an array to be granted (AND logic)', () => {
    mockUseHasPermission.mockReturnValue(true);

    render(
      <RequiredPermissions permission={['org:manage', 'logs:view']}>
        {TestContent}
      </RequiredPermissions>
    );

    expect(screen.getByTestId('secret-content')).toBeInTheDocument();
  });
});

// ========================================================================
// HAS ANY PERMISSION (OR LOGIC)
// ========================================================================

describe('HasAnyPermission (OR Logic)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const TestContent = <div data-testid="any-access-area">Public Dashboard</div>;

  it('renders children when the user has at least ONE of the required permissions', () => {
    mockUseHasAnyPermission.mockReturnValue(true);

    render(
      <HasAnyPermission permission={['org:view', 'logs:read']}>
        {TestContent}
      </HasAnyPermission>
    );

    expect(screen.getByTestId('any-access-area')).toBeInTheDocument();
  });

  it('does NOT render children when the user has NONE of the permissions', () => {
    mockUseHasAnyPermission.mockReturnValue(false);

    render(
      <HasAnyPermission permission={['org:view', 'logs:read']}>
        {TestContent}
      </HasAnyPermission>
    );

    expect(screen.queryByTestId('any-access-area')).not.toBeInTheDocument();
  });

  it('renders a custom fallback if the user is denied', () => {
    mockUseHasAnyPermission.mockReturnValue(false);

    render(
      <HasAnyPermission 
        permission={['admin:master']} 
        onForbidden={<div data-testid="forbidden-msg">Access Denied</div>}
      >
        <div data-testid="secret-content">Secret Area</div>
      </HasAnyPermission>
    );

    expect(screen.getByTestId('forbidden-msg')).toBeInTheDocument();
    expect(screen.queryByTestId('secret-content')).not.toBeInTheDocument();
  });

  it('renders nothing (default onForbidden) while loading', () => {
    mockUseHasAnyPermission.mockReturnValue(undefined);

    const { container } = render(
      <HasAnyPermission permission={['org:view']}>
        {TestContent}
      </HasAnyPermission>
    );

    expect(container.firstChild).toBeNull();
  });

  it('accepts a single string permission (not just arrays)', () => {
    mockUseHasAnyPermission.mockReturnValue(true);

    render(
      <HasAnyPermission permission="org:view">{TestContent}</HasAnyPermission>
    );

    expect(mockUseHasAnyPermission).toHaveBeenCalledWith(['org:view']);
    expect(screen.getByTestId('any-access-area')).toBeInTheDocument();
  });
});

// ========================================================================
// ROLE GUARD (ROLE-BASED, AND LOGIC)
// ========================================================================

describe('RoleGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const TestContent = <div data-testid="role-only-area">Role Only Area</div>;

  it('renders children when the user has all required roles', () => {
    mockUseUserRoles.mockReturnValue(roles(['admin', 'manager']));

    render(<RoleGuard role="admin">{TestContent}</RoleGuard>);

    expect(screen.getByTestId('role-only-area')).toBeInTheDocument();
  });

  it('renders children when the user has EVERY role in an array (AND logic)', () => {
    mockUseUserRoles.mockReturnValue(roles(['admin', 'manager']));

    render(<RoleGuard role={['admin', 'manager']}>{TestContent}</RoleGuard>);

    expect(screen.getByTestId('role-only-area')).toBeInTheDocument();
  });

  it('does NOT render children when one of the required roles is missing', () => {
    mockUseUserRoles.mockReturnValue(roles(['viewer']));

    render(
      <RoleGuard role={['admin', 'manager']}>
        {TestContent}
      </RoleGuard>
    );

    expect(screen.queryByTestId('role-only-area')).not.toBeInTheDocument();
  });

  it('does NOT render children when the user has no roles at all', () => {
    mockUseUserRoles.mockReturnValue(roles([]));

    render(<RoleGuard role="admin">{TestContent}</RoleGuard>);

    expect(screen.queryByTestId('role-only-area')).not.toBeInTheDocument();
  });

  it('treats a missing roles payload as an empty list (denied)', () => {
    mockUseUserRoles.mockReturnValue(roles(null));

    render(<RoleGuard role="admin">{TestContent}</RoleGuard>);

    expect(screen.queryByTestId('role-only-area')).not.toBeInTheDocument();
  });

  it('renders nothing while roles are loading (FOUC protection)', () => {
    mockUseUserRoles.mockReturnValue(roles(['admin'], true));

    const { container, rerender } = render(
      <RoleGuard role="admin">
        {TestContent}
      </RoleGuard>
    );

    expect(container.firstChild).toBeNull();

    mockUseUserRoles.mockReturnValue(roles(['admin']));
    rerender(
      <RoleGuard role="admin">
        {TestContent}
      </RoleGuard>
    );

    expect(screen.getByTestId('role-only-area')).toBeInTheDocument();
  });

  it('renders the onForbidden fallback when access is denied', () => {
    mockUseUserRoles.mockReturnValue(roles(['viewer']));

    render(
      <RoleGuard role="admin" onForbidden={<div data-testid="denied">Nope</div>}>
        {TestContent}
      </RoleGuard>
    );

    expect(screen.getByTestId('denied')).toBeInTheDocument();
    expect(screen.queryByTestId('role-only-area')).not.toBeInTheDocument();
  });
});