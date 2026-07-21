/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RequireSuperAdmin } from '@/components/auth/RequireSuperAdmin';
import { useIsSuperAdmin } from '@/hooks/usePermission';

vi.mock('@/hooks/usePermission', () => ({
  useIsSuperAdmin: vi.fn(),
}));

describe('RequireSuperAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders children when user is Super Admin', () => {
    vi.mocked(useIsSuperAdmin).mockReturnValue(true);

    render(
      <RequireSuperAdmin>
        <div>Super Admin Access</div>
      </RequireSuperAdmin>
    );

    expect(screen.getByText('Super Admin Access')).toBeInTheDocument();
  });

  it('renders fallback when user is not Super Admin', () => {
    // We mock it to return false. 
    // The component should handle this by showing the fallback, not loading.
    vi.mocked(useIsSuperAdmin).mockReturnValue(false);

    render(
      <RequireSuperAdmin fallback={<div>Access Denied</div>}>
        <div>Super Admin Access</div>
      </RequireSuperAdmin>
    );

    expect(screen.getByText('Access Denied')).toBeInTheDocument();
  });
});
