import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RequirePermission } from '@/components/auth/RequirePermission';

// Mock hooks
vi.mock('@/hooks/usePermission', () => ({
  useHasPermission: vi.fn(),
  useAnyPermission: vi.fn(),
  useAllPermissions: vi.fn(),
  useIsSuperAdmin: vi.fn(),
}));

import { useHasPermission, useAnyPermission, useAllPermissions, useIsSuperAdmin } from '@/hooks/usePermission';

describe('RequirePermission', () => {
  it('renders children when user has the permission', () => {
    vi.mocked(useIsSuperAdmin).mockReturnValue(false);
    vi.mocked(useHasPermission).mockReturnValue(true);

    render(
      <RequirePermission permission="properties:create">
        <div data-testid="child">Content</div>
      </RequirePermission>
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('renders nothing when user lacks the permission', () => {
    vi.mocked(useIsSuperAdmin).mockReturnValue(false);
    vi.mocked(useHasPermission).mockReturnValue(false);

    const { container } = render(
      <RequirePermission permission="properties:create">
        <div>Content</div>
      </RequirePermission>
    );

    expect(container.innerHTML).toBe('');
  });

  it('renders fallback when permission denied and fallback provided', () => {
    vi.mocked(useIsSuperAdmin).mockReturnValue(false);
    vi.mocked(useHasPermission).mockReturnValue(false);

    render(
      <RequirePermission permission="properties:create" fallback={<div data-testid="fallback">Access Denied</div>}>
        <div>Content</div>
      </RequirePermission>
    );

    expect(screen.getByTestId('fallback')).toBeInTheDocument();
  });

  it('always renders for Super Admin regardless of permissions', () => {
    vi.mocked(useIsSuperAdmin).mockReturnValue(true);
    vi.mocked(useHasPermission).mockReturnValue(false);

    render(
      <RequirePermission permission="admin:super">
        <div data-testid="child">Content</div>
      </RequirePermission>
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('uses useAnyPermission when mode="any" with array', () => {
    vi.mocked(useIsSuperAdmin).mockReturnValue(false);
    vi.mocked(useAnyPermission).mockReturnValue(true);

    render(
      <RequirePermission permission={['perm:a', 'perm:b']} mode="any">
        <div data-testid="child">Content</div>
      </RequirePermission>
    );

    expect(useAnyPermission).toHaveBeenCalledWith(['perm:a', 'perm:b'], undefined);
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('uses useAllPermissions when mode="all" with array', () => {
    vi.mocked(useIsSuperAdmin).mockReturnValue(false);
    vi.mocked(useAllPermissions).mockReturnValue(false);

    const { container } = render(
      <RequirePermission permission={['perm:a', 'perm:b']} mode="all">
        <div>Content</div>
      </RequirePermission>
    );

    expect(useAllPermissions).toHaveBeenCalledWith(['perm:a', 'perm:b'], undefined);
    expect(container.innerHTML).toBe('');
  });

  it('defaults to "all" mode when not specified', () => {
    vi.mocked(useIsSuperAdmin).mockReturnValue(false);
    vi.mocked(useAllPermissions).mockReturnValue(true);

    render(
      <RequirePermission permission={['perm:a', 'perm:b']}>
        <div data-testid="child">Content</div>
      </RequirePermission>
    );

    expect(useAllPermissions).toHaveBeenCalled();
  });

  it('passes orgId to hooks when provided', () => {
    vi.mocked(useIsSuperAdmin).mockReturnValue(false);
    vi.mocked(useHasPermission).mockReturnValue(true);

    render(
      <RequirePermission permission="properties:create" orgId="org-123">
        <div>Content</div>
      </RequirePermission>
    );

    expect(useHasPermission).toHaveBeenCalledWith('properties:create', 'org-123');
  });
});