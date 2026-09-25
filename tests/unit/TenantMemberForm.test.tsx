/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TenantMemberForm } from '@/components/admin/TenantMemberForm';

describe('TenantMemberForm', () => {
  it('renders email input with correct label and placeholder', () => {
    render(<TenantMemberForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('user@example.com')).toBeInTheDocument();
  });

  it('renders role select with default value member', () => {
    render(<TenantMemberForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

    const select = screen.getByLabelText(/role/i) as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select.value).toBe('member');
  });

  it('renders submit button with correct text', () => {
    render(<TenantMemberForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole('button', { name: /add member/i })).toBeInTheDocument();
  });

  it('renders cancel button with correct text', () => {
    render(<TenantMemberForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('calls onSubmit with email and role when form submitted', async () => {
    const onSubmit = vi.fn<() => Promise<void>>(async () => {});
    render(<TenantMemberForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'user@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add member/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ email: 'user@example.com', role: 'member' });
    });
  });

  it('trims whitespace from email before submitting', async () => {
    const onSubmit = vi.fn<() => Promise<void>>(async () => {});
    render(<TenantMemberForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: '  user@example.com  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add member/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ email: 'user@example.com', role: 'member' });
    });
  });

  it('does not call onSubmit when email is empty', async () => {
    const onSubmit = vi.fn<() => Promise<void>>(async () => {});
    render(<TenantMemberForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /add member/i }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not call onSubmit when email is whitespace only', async () => {
    const onSubmit = vi.fn<() => Promise<void>>(async () => {});
    render(<TenantMemberForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add member/i }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<TenantMemberForm onSubmit={vi.fn()} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('disables submit button and shows loading text while submitting', async () => {
    const onSubmit = vi.fn<() => Promise<void>>(async () => {});
    render(<TenantMemberForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'user@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add member/i }));

    // Button should be disabled during submission
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /adding\.\.\./i })).toBeDisabled();
    });
  });

  it('re-enables submit button after submission completes', async () => {
    let resolveFn: (() => void) | undefined;
    const onSubmit = vi.fn<() => Promise<void>>(
      () => new Promise((resolve) => { resolveFn = resolve; })
    );
    render(<TenantMemberForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'user@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add member/i }));

    // Resolve the async submission
    resolveFn?.();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add member/i })).toBeEnabled();
    });
  });

  it('resets form fields after successful submission', async () => {
    let resolveFn: (() => void) | undefined;
    const onSubmit = vi.fn<() => Promise<void>>(
      () => new Promise((resolve) => { resolveFn = resolve; })
    );
    render(<TenantMemberForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'user@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add member/i }));

    resolveFn?.();

    await waitFor(() => {
      expect(screen.getByLabelText(/email address/i)).toHaveValue('');
    });
  });

  it('uses correct design tokens (Navy header, Amber button)', () => {
    const { container } = render(
      <TenantMemberForm onSubmit={vi.fn()} onCancel={vi.fn()} />
    );

    // Header and button use design tokens as inline CSS vars (see app/globals.css:
    // --color-navy-850 = #1B2A4A, --color-accent = #F5A623)
    const header = container.querySelector('h3');
    expect(header).toHaveStyle({ color: 'var(--color-navy-850)' });

    // Check submit button has Amber background
    const submitButton = screen.getByRole('button', { name: /add member/i });
    expect(submitButton).toHaveStyle({ backgroundColor: 'var(--color-accent)' });
  });

  it('uses role select with all expected options', () => {
    render(<TenantMemberForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

    const select = screen.getByLabelText(/role/i) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);

    expect(options).toContain('member');
    expect(options).toContain('admin');
    expect(options).toContain('property-manager');
    expect(options).toContain('viewer');
  });

  it('respects custom role selection', async () => {
    const onSubmit = vi.fn<() => Promise<void>>(async () => {});
    render(<TenantMemberForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    const select = screen.getByLabelText(/role/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'admin' } });

    // Verify the select value changed
    expect(select.value).toBe('admin');
  });
});
