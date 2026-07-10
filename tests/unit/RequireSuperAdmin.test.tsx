/**
 * Unit test: RequireSuperAdmin component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/hooks/usePermission', () => ({
  useIsSuperAdmin: vi.fn(),
}));

const { RequireSuperAdmin } = await import('@/components/auth/RequireSuperAdmin');
const { useIsSuperAdmin } = await import('@/hooks/usePermission');

describe('RequireSuperAdmin', () => {
  it('should render AccessDenied for non-admin user', () => {
    vi.mocked(useIsSuperAdmin).mockReturnValue(false);

    render(
      <RequireSuperAdmin>
        <div data-testid="children">Protected Content</div>
      </RequireSuperAdmin>
    );

    expect(screen.getByText('Access Denied')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('should render children for admin user', () => {
    vi.mocked(useIsSuperAdmin).mockReturnValue(true);

    render(
      <RequireSuperAdmin>
        <div data-testid="children">Protected Content</div>
      </RequireSuperAdmin>
    );

    expect(screen.getByText('Protected Content')).toBeInTheDocument();
    expect(screen.queryByText('Access Denied')).not.toBeInTheDocument();
  });

  it('should render custom fallback when provided', () => {
    vi.mocked(useIsSuperAdmin).mockReturnValue(false);

    render(
      <RequireSuperAdmin fallback={<div data-testid="custom-fallback">Custom Fallback</div>}>
        <div data-testid="children">Protected Content</div>
      </RequireSuperAdmin>
    );

    expect(screen.getByText('Custom Fallback')).toBeInTheDocument();
  });
});
