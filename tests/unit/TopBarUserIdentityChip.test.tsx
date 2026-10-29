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

/** Stub /api/auth/me with a chosen credential-account flag (chip's dropdown state). */
function stubMe(hasPassword: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('/api/auth/me')) {
        return new Response(JSON.stringify({ organizationName: '', hasPassword }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
    }),
  );
}

function renderChip(name = 'Jane Doe', email = 'jane@example.com') {
  mockUseSession.mockReturnValue({
    data: { user: { name, email } },
    loading: false,
  });
  const utils = render(<TopBarUserIdentityChip />);
  return { ...utils, trigger: screen.getByRole('button', { name: /account menu for jane doe/i }) };
}

function getChangePw() {
  return screen.getByRole('menuitem', { name: /change password/i });
}

describe('TopBarUserIdentityChip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mockSignOutUser.mockResolvedValue({ success: true });
    // The chip fetches /api/auth/me for the Change Password state — default to a
    // Google-only account so only explicit tests enable it.
    stubMe(false);
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
    // Change Password sits between User Info and Log out for every account —
    // greyed out (aria-disabled) until /api/auth/me proves a credential.
    const changePw = screen.getByRole('menuitem', { name: /change password/i });
    expect(changePw).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /log out/i })).toBeInTheDocument();
    // Ordering: User Info → Change Password → Log out.
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['User Info', 'Change Password', 'Log out']);
    expect(changePw).toHaveAttribute('aria-disabled', 'true');

    // Clicking the trigger again closes it.
    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('keeps Change Password disabled for a Google-only account and opens nothing on click', async () => {
    stubMe(false);
    const { trigger } = renderChip();
    // Wait for the /me fetch to land, then open the menu — the item only
    // exists once the dropdown is rendered.
    await vi.waitFor(() => {
      fireEvent.click(trigger);
      expect(getChangePw()).toHaveAttribute('aria-disabled', 'true');
    });

    fireEvent.click(getChangePw());

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('enables Change Password for a local account and opens the modal', async () => {
    stubMe(true);
    const { trigger } = renderChip();
    await vi.waitFor(() => {
      fireEvent.click(trigger);
      expect(getChangePw()).toHaveAttribute('aria-disabled', 'false');
    });

    fireEvent.click(getChangePw());

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    const modal = await screen.findByText('Change Password');
    expect(modal).toBeInTheDocument();
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ organizationName: 'Acme Drilling Ltd', userType: 'OIDC' }) }));
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

  it('shows User Type OIDC between Email and Organization for a verified Google identity', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ organizationName: '', userType: 'OIDC' }) }));
    const { trigger } = renderChip();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: /user info/i }));

    const modal = await screen.findByRole('dialog');
    expect(await screen.findByText('OIDC')).toBeInTheDocument();

    // Row order inside the modal's <dl>: Email → User Type → Organization.
    const rows = Array.from(modal.querySelectorAll('dt')).map((dt) => dt.textContent);
    expect(rows).toEqual(['Name', 'Email', 'User Type', 'Organization']);
  });

  it('shows User Type Local for a local credential account', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ organizationName: '', userType: 'Local' }) }));
    const { trigger } = renderChip();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: /user info/i }));

    await screen.findByRole('dialog');
    expect(await screen.findByText('Local')).toBeInTheDocument();
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
