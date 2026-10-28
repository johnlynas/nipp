/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TopBarUserIdentityChip } from '@/components/dashboard/TopBarUserIdentityChip';
import * as authClientModule from '@/lib/auth-client';

vi.mock('@/lib/auth-client', () => ({
  useSession: vi.fn(),
  signOutUser: vi.fn(),
}));

const mockUseSession = vi.mocked(authClientModule.useSession);
const mockSignOutUser = vi.mocked(authClientModule.signOutUser);

const replaceSpy = vi.fn();
// jsdom's window.location is not reliably redefinable per-test; use the repo idiom:
// swap the whole object once at module load (see useInactivityTimeout.test.tsx).
const mockLocation = { href: '', replace: replaceSpy };
Object.defineProperty(window, 'location', { value: mockLocation, writable: true });

function renderChip(name = 'Jane Doe', email = 'jane@example.com') {
  mockUseSession.mockReturnValue({
    data: { user: { name, email } },
    loading: false,
  });
  const utils = render(<TopBarUserIdentityChip />);
  return { ...utils, trigger: screen.getByRole('button', { name: /account menu for jane doe/i }) };
}

describe('TopBarUserIdentityChip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mockSignOutUser.mockResolvedValue({ success: true });
  });

  it('renders the avatar, name and email', () => {
    renderChip();
    expect(screen.getByText('JD')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getAllByText('jane@example.com').length).toBeGreaterThan(0);
  });

  it('renders nothing without a session user', () => {
    mockUseSession.mockReturnValue({ data: null, loading: false });
    const { container } = render(<TopBarUserIdentityChip />);
    expect(container.innerHTML).toBe('');
  });

  it('opens the dropdown on left click with User Info and Log out items', async () => {
    const { trigger } = renderChip();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menuitem', { name: /user info/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /log out/i })).toBeInTheDocument();

    // Clicking the trigger again closes it.
    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on Escape and on outside click', async () => {
    const { trigger } = renderChip();
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('User Info opens a modal with the user details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ organizationName: 'Acme Drilling Ltd' }) }));
    const { trigger } = renderChip();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: /user info/i }));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    const modal = await screen.findByRole('dialog');
    expect(modal).toHaveTextContent('User Info');
    expect(modal).toHaveTextContent('Jane Doe');
    expect(modal).toHaveTextContent('jane@example.com');

    fireEvent.click(screen.getAllByRole('button', { name: /close modal/i })[0]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the organization from /api/auth/me in the modal when present', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ organizationName: 'Acme Drilling Ltd' }) }));
    const { trigger } = renderChip();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: /user info/i }));

    expect(await screen.findByText('Acme Drilling Ltd')).toBeInTheDocument();
  });

  it('handles a failing /api/auth/me without breaking the modal', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    const { trigger } = renderChip();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: /user info/i }));

    expect(await screen.findByRole('dialog')).toHaveTextContent('Jane Doe');
  });

  it('Log out signs out and redirects to /login', async () => {
    const { trigger } = renderChip();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: /log out/i }));

    expect(mockSignOutUser).toHaveBeenCalledTimes(1);
    // Redirect happens after signOut resolves — flush microtasks.
    await vi.waitFor(() => expect(replaceSpy).toHaveBeenCalledTimes(1));
    expect(replaceSpy.mock.calls[0][0]).toMatch(/^\/login\?t=\d+$/);
  });

  it('does not redirect when sign-out fails', async () => {
    mockSignOutUser.mockResolvedValue({ error: 'boom' } as any);
    const { trigger } = renderChip();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: /log out/i }));

    expect(mockSignOutUser).toHaveBeenCalledTimes(1);
    // Let the failed sign-out flow settle, then confirm no redirect was dispatched.
    await new Promise((r) => setTimeout(r, 0));
    expect(replaceSpy).not.toHaveBeenCalled();
  });
});
