/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { RequirePermission } from '@/components/auth/RequirePermission';
import { useHasPermission } from '@/hooks/usePermission';

vi.mock('@/hooks/usePermission');

describe('RequirePermission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders children when user has the permission', async () => {
    vi.mocked(useHasPermission).mockReturnValue(true);

    const { getByText } = render(
      <RequirePermission permission="properties:view">
        <div>Permission Granted</div>
      </RequirePermission>
    );

    await waitFor(() => {
      expect(getByText('Permission Granted')).toBeInTheDocument();
    });
  });

  it('renders fallback when user lacks the permission', async () => {
    vi.mocked(useHasPermission).mockReturnValue(false);

    const { getByText } = render(
      <RequirePermission permission="properties:view" fallback={<div>Access Denied</div>}>
        <div>Permission Granted</div>
      </RequirePermission>
    );

    await waitFor(() => {
      expect(getByText('Access Denied')).toBeInTheDocument();
    });
  });
});
