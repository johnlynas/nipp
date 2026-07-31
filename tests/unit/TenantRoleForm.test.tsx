/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TenantRoleForm } from '@/components/admin/TenantRoleForm';

describe('TenantRoleForm', () => {
  it('renders name input with correct label and placeholder', () => {
    render(<TenantRoleForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByLabelText(/role name/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Custom Role')).toBeInTheDocument();
  });

  it('renders description input with correct label and placeholder', () => {
    render(<TenantRoleForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Optional description')).toBeInTheDocument();
  });

  it('renders submit button with correct text', () => {
    render(<TenantRoleForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole('button', { name: /create role/i })).toBeInTheDocument();
  });

  it('renders cancel button with correct text', () => {
    render(<TenantRoleForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('calls onSubmit with name and description when form submitted', async () => {
    const onSubmit = vi.fn<() => Promise<void>>(async () => {});
    render(<TenantRoleForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/role name/i), {
      target: { value: 'Custom Role' },
    });
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: 'A custom role' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create role/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'Custom Role',
        description: 'A custom role',
      });
    });
  });

  it('does not call onSubmit when name is empty', async () => {
    const onSubmit = vi.fn<() => Promise<void>>(async () => {});
    render(<TenantRoleForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /create role/i }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not call onSubmit when name is whitespace only', async () => {
    const onSubmit = vi.fn<() => Promise<void>>(async () => {});
    render(<TenantRoleForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/role name/i), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create role/i }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<TenantRoleForm onSubmit={vi.fn()} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('disables submit button and shows loading text while submitting', async () => {
    const onSubmit = vi.fn<() => Promise<void>>(async () => {});
    render(<TenantRoleForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/role name/i), {
      target: { value: 'Custom Role' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create role/i }));

    // Button should be disabled during submission
    expect(screen.getByRole('button', { name: /creating\.\.\./i })).toBeDisabled();
  });

  it('re-enables submit button after submission completes', async () => {
    let resolveFn: (() => void) | undefined;
    const onSubmit = vi.fn<() => Promise<void>>(
      () => new Promise((resolve) => { resolveFn = resolve; })
    );
    render(<TenantRoleForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/role name/i), {
      target: { value: 'Custom Role' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create role/i }));

    // Resolve the async submission
    resolveFn?.();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /create role/i })).toBeEnabled();
    });
  });

  it('resets form fields after successful submission', async () => {
    let resolveFn: (() => void) | undefined;
    const onSubmit = vi.fn<() => Promise<void>>(
      () => new Promise((resolve) => { resolveFn = resolve; })
    );
    render(<TenantRoleForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/role name/i), {
      target: { value: 'Custom Role' },
    });
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: 'A custom role' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create role/i }));

    resolveFn?.();

    await waitFor(() => {
      expect(screen.getByLabelText(/role name/i)).toHaveValue('');
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/description/i)).toHaveValue('');
    });
  });

  it('uses correct design tokens (Navy header, Amber button)', () => {
    const { container } = render(
      <TenantRoleForm onSubmit={vi.fn()} onCancel={vi.fn()} />
    );

    // Check header has Navy color
    const header = container.querySelector('h3');
    expect(header).toHaveStyle({ color: '#1B2A4A' });

    // Check submit button has Amber background
    const submitButton = screen.getByRole('button', { name: /create role/i });
    expect(submitButton).toHaveStyle({ backgroundColor: '#F5A623' });
  });

  it('has required attribute on name input', () => {
    render(<TenantRoleForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

    const nameInput = screen.getByLabelText(/role name/i) as HTMLInputElement;
    expect(nameInput).toHaveAttribute('required');
  });

  it('description input is optional (no required attribute)', () => {
    render(<TenantRoleForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

    const descInput = screen.getByLabelText(/description/i) as HTMLInputElement;
    expect(descInput).not.toHaveAttribute('required');
  });

  it('allows submitting with empty description', async () => {
    const onSubmit = vi.fn<() => Promise<void>>(async () => {});
    render(<TenantRoleForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/role name/i), {
      target: { value: 'Custom Role' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create role/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'Custom Role',
        description: '',
      });
    });
  });

  it('uses text input type for name field', () => {
    render(<TenantRoleForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

    const nameInput = screen.getByLabelText(/role name/i) as HTMLInputElement;
    expect(nameInput.type).toBe('text');
  });

  it('uses text input type for description field', () => {
    render(<TenantRoleForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

    const descInput = screen.getByLabelText(/description/i) as HTMLInputElement;
    expect(descInput.type).toBe('text');
  });
});
