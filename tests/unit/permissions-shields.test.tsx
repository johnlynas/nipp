/** 
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// --- Mock Setup ---
// We strictly mock the hooks we need to test so we can control exactly what "logic" they return (true/false/undefined).
vi.mock('@/features/permissions/api/usePermissions', () => ({
  useHasPermission: vi.fn(),       // Used by RequiredPermissions (AND logic)
  useHasAnyPermission: vi.fn(),    // Used by HasAnyPermission (OR logic)
}));

// 1. Import the mocked hooks so we can modify their return values in tests
import * as PermissionsAPI from '@/features/permissions/api/usePermissions';

// 2. Import the Components under test 
import { RequiredPermissions, HasAnyPermission } from '@/features/permissions';

// ========================================================================
// REQUIRED PERMISSIONS (AND LOGIC)
// Renders children ONLY if the user has ALL specified permissions.
// ========================================================================

describe('RequiredPermissions (AND Logic)', () => {
  beforeEach(() => {
    vi.clearAllMocks(); // Clear the call history between tests (but keep mock structure).
  });

  const TestContent = <div data-testid="secret-content">Secret Admin Area</div>;

  it('renders children when the user has all required permissions', () => {
    // Simulate successful authorization check (true)
    PermissionsAPI.useHasPermission.mockReturnValue(true);

    render(
      <RequiredPermissions permission="org:manage">
        {TestContent}
      </RequiredPermissions>
    );

    expect(screen.getByTestId('secret-content')).toBeInTheDocument();
  });

  it('does NOT render children when the user is denied', () => {
    // Simulate failed authorization check (false)
    PermissionsAPI.useHasPermission.mockReturnValue(false);

    render(
      <RequiredPermissions permission="org:manage">
        {TestContent}
      </RequiredPermissions>
    );

    // The data-testid should be completely absent from the rendered DOM
    expect(screen.queryByTestId('secret-content')).not.toBeInTheDocument();
  });

  it('does not flash the UI while fetching permissions (Prevents FOUC)', () => {
    // 1. Simulate initial loading state -> undefined tells our hook to not render yet
    PermissionsAPI.useHasPermission.mockReturnValue(undefined);

    // Render the component initially while state is "undefined" (Loading)
    const { rerender } = render(
      <RequiredPermissions permission="org:manage">
        {TestContent}
      </RequiredPermissions>
    );

    // Because we return `null` in undefined state, checking the DOM should find nothing
    expect(screen.queryByTestId('secret-content')).not.toBeInTheDocument();

    // 2. Simulate a backend response coming back after a few milliseconds
    PermissionsAPI.useHasPermission.mockReturnValue(true);

    // 3. Force a re-render to see the visual update for the new mock state
    rerender(
      <RequiredPermissions permission="org:manage">
        {TestContent}
      </RequiredPermissions>
    );

    // 4. Verify the content is finally visible!
    expect(screen.getByTestId('secret-content')).toBeInTheDocument();
  });

  it('requires all permissions in an array to be granted (AND logic)', () => {
    PermissionsAPI.useHasPermission.mockReturnValue(true);

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
// Renders children if the user has AT LEAST ONE of the permissions.
// ========================================================================

describe('HasAnyPermission (OR Logic)', () => {
  beforeEach(() => {
    vi.clearAllMocks(); 
  });

  const TestContent = <div data-testid="any-access-area">Public Dashboard</div>;

  it('renders children when the user has at least ONE of the required permissions', () => {
    PermissionsAPI.useHasAnyPermission.mockReturnValue(true);

    render(
      <HasAnyPermission permission={['org:view', 'logs:read']}>
        {TestContent}
      </HasAnyPermission>
    );

    expect(screen.getByTestId('any-access-area')).toBeInTheDocument();
  });

  it('does NOT render children when the user has NONE of the permissions', () => {
    PermissionsAPI.useHasAnyPermission.mockReturnValue(false);

    render(
      <HasAnyPermission permission={['org:view', 'logs:read']}>
        {TestContent}
      </HasAnyPermission>
    );

    expect(screen.queryByTestId('any-access-area')).not.toBeInTheDocument();
  });

  it('renders a custom fallback if the user is denied', () => {
    PermissionsAPI.useHasAnyPermission.mockReturnValue(false);

    render(
      <HasAnyPermission 
        permission={['admin:master']} 
        onForbidden={<div data-testid="forbidden-msg">Access Denied</div>}
      >
        <div data-testid="secret-content">Secret Area</div>
      </HasAnyPermission>
    );

    // Fallback appears in the DOM as intended
    expect(screen.getByTestId('forbidden-msg')).toBeInTheDocument(); 
    
    // Content remains hidden
    expect(screen.queryByTestId('secret-content')).not.toBeInTheDocument(); 
  });

});
