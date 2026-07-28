/** 
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// --- Mock Setup ---
vi.mock('@/features/permissions/api/usePermissions', () => ({
  useHasPermission: vi.fn(),
  useHasAnyPermission: vi.fn(),
}));

import * as PermissionsAPI from '@/features/permissions/api/usePermissions';
import { RequiredPermissions, HasAnyPermission } from '@/features/permissions';

// Wrap with vi.mocked() so TypeScript knows these are mocks
const mockUseHasPermission = vi.mocked(PermissionsAPI.useHasPermission);
const mockUseHasAnyPermission = vi.mocked(PermissionsAPI.useHasAnyPermission);

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
});