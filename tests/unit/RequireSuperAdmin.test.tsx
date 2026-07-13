import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { RequireSuperAdmin } from '@/components/auth/RequireSuperAdmin';
import { useIsSuperAdmin } from '@/hooks/usePermission';

import '@testing-library/jest-dom';

vi.mock('@/hooks/usePermission');

describe('RequireSuperAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders children when user is Super Admin', async () => {
    vi.mocked(useIsSuperAdmin).mockReturnValue(true);

    const { getByText } = render(
      <RequireSuperAdmin>
        <div>Super Admin Access</div>
      </RequireSuperAdmin>
    );

    await waitFor(() => {
      expect(getByText('Super Admin Access')).toBeInTheDocument();
    });
  });

  it('renders fallback when user is not Super Admin', async () => {
    vi.mocked(useIsSuperAdmin).mockReturnValue(false);

    const { getByText } = render(
      <RequireSuperAdmin fallback={<div>Access Denied</div>}>
        <div>Super Admin Access</div>
      </RequireSuperAdmin>
    );

    await waitFor(() => {
      expect(getByText('Access Denied')).toBeInTheDocument();
    });
  });
});