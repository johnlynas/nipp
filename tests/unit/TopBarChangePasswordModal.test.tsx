/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TopBarChangePasswordModal } from '@/components/dashboard/TopBarChangePasswordModal';

vi.mock('@/lib/client-error-logger', () => ({
  logClientError: vi.fn(),
}));

function open() {
  return render(<TopBarChangePasswordModal isOpen onClose={() => {}} />);
}

describe('TopBarChangePasswordModal', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders two password fields with visibility toggles and OK/Cancel buttons', () => {
    open();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const pw = screen.getByLabelText('New Password') as HTMLInputElement;
    const confirm = screen.getByLabelText('Confirm Password') as HTMLInputElement;
    expect(pw).toHaveAttribute('type', 'password');
    expect(confirm).toHaveAttribute('type', 'password');

    // Toggles start dimmed/disabled on an empty field, once typed they reveal.
    const pwToggle = screen.getByRole('button', { name: /show new password/i });
    expect(pwToggle).toBeDisabled();

    fireEvent.change(pw, { target: { value: 'hunter2' } });
    expect(screen.getByRole('button', { name: /show new password/i })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /show new password/i }));
    expect(pw).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: /hide new password/i })).toHaveAttribute('aria-pressed', 'true');

    // Toggling back hides it again.
    fireEvent.click(screen.getByRole('button', { name: /hide new password/i }));
    expect(pw).toHaveAttribute('type', 'password');

    expect(screen.getByRole('button', { name: /^ok$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('shows a mismatch error, stays open, and sends nothing when fields differ', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    open();

    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'hunter2' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'hunter3' } });
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/do not match/i);
    // Modal stayed open; nothing left the browser.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    // Correcting one field clears the mismatch.
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'hunter2' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('sends matching passwords, shows "Password updated", and closes', async () => {
    const fetchMock = vi.fn(
      async (url: string | URL | Request, options: RequestInit = {}) => {
        if (String(url).includes('/api/auth/password') && (options.method ?? 'GET').toUpperCase() === 'POST') {
          return new Response(JSON.stringify({ success: true, message: 'Password updated' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
      },
    );
    vi.useFakeTimers();
    vi.stubGlobal('fetch', fetchMock);
    const onDone = vi.fn();
    render(<TopBarChangePasswordModal isOpen onClose={onDone} />);
    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 's3cret!' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 's3cret!' } });
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));

    // Flush pending promises, then advance past the 900ms close delay.
    await vi.advanceTimersByTimeAsync(1000);
    vi.useRealTimers();

    // "Password updated" confirmation is showing (the test pins isOpen, so the
    // success view stays mounted while onClose fired exactly once).
    expect(screen.getByText('Password updated')).toBeInTheDocument();
    expect(onDone).toHaveBeenCalledTimes(1);

    // Exactly one POST with the new password.
    const calls = fetchMock.mock.calls.filter(
      ([, opts]) => (opts?.method ?? '').toUpperCase() === 'POST',
    );
    expect(calls.length).toBe(1);
    expect(String((calls[0] as [string])[0])).toContain('/api/auth/password');
    expect(JSON.parse(String((calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ password: 's3cret!' });
  });

  it('surfaces a server error inside the open modal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'Database unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } })),
    );
    open();

    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 's3cret!' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 's3cret!' } });
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/database unavailable/i);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('Cancel closes the modal without any request', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    let closed = false;
    render(<TopBarChangePasswordModal isOpen onClose={() => { closed = true; }} />);

    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(closed).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('OK is disabled until both fields are filled', () => {
    open();
    const ok = screen.getByRole('button', { name: /^ok$/i }) as HTMLButtonElement;
    expect(ok).toBeDisabled();
    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'abc' } });
    expect(ok).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'abc' } });
    expect(ok).not.toBeDisabled();
  });

  it('resets fields on each open', async () => {
    const utils = open();
    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'stale-value' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'stale-value' } });

    utils.unmount();
    open();
    expect((screen.getByLabelText('New Password') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Confirm Password') as HTMLInputElement).value).toBe('');
  });
});
