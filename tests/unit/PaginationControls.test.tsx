/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PaginationControls } from '@/components/admin/PaginationControls';

describe('PaginationControls', () => {
  const defaultProps = {
    currentPage: 1,
    totalPages: 5,
    totalItems: 40,
    pageSize: 8,
    onPageChange: vi.fn(),
  };

  function renderComponent(props = defaultProps) {
    return render(<PaginationControls {...props} />);
  }

  // ── Rendering ───────────────────────────────────────────────

  it('renders a single-page footer with range label and inert controls', () => {
    const { container } = renderComponent({ ...defaultProps, totalPages: 1 });
    // One page still shows the "Showing X–Y of Z entries" row (consistent
    // with the multi-page layout); Previous/Next are inert spans, not buttons.
    expect(container.firstChild).not.toBeNull();
    expect(screen.getByText(/Showing 1–8 of 40 entries/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Previous')).toHaveClass('opacity-40');
    expect(screen.getByText('Next')).toHaveClass('opacity-40');
    expect(screen.getByText('1')).toHaveClass('bg-navy-850');
  });

  it('renders nothing when there are zero pages', () => {
    const { container } = renderComponent({ ...defaultProps, totalPages: 0 });
    expect(container.firstChild).toBeNull();
  });

  it('shows the correct "Showing X–Y of Z entries" text', () => {
    renderComponent({ ...defaultProps, currentPage: 2 });
    expect(screen.getByText(/Showing 9–16 of 40 entries/)).toBeInTheDocument();
  });

  it('shows correct range for last page', () => {
    renderComponent({ ...defaultProps, currentPage: 5 });
    expect(screen.getByText(/Showing 33–40 of 40 entries/)).toBeInTheDocument();
  });

  it('shows Previous and Next buttons', () => {
    renderComponent();
    expect(screen.getByRole('button', { name: /previous page/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next page/i })).toBeInTheDocument();
  });

  // ── Previous / Next disabled states ─────────────────────────

  it('disables Previous on page 1', () => {
    renderComponent({ ...defaultProps, currentPage: 1 });
    const prev = screen.getByRole('button', { name: /previous page/i });
    expect(prev).toHaveClass('opacity-40');
  });

  it('enables Previous on page > 1', () => {
    renderComponent({ ...defaultProps, currentPage: 3 });
    const prev = screen.getByRole('button', { name: /previous page/i });
    expect(prev).not.toHaveClass('opacity-40');
  });

  it('disables Next on the last page', () => {
    renderComponent({ ...defaultProps, currentPage: 5 });
    const next = screen.getByRole('button', { name: /next page/i });
    expect(next).toHaveClass('opacity-40');
  });

  it('enables Next when not on the last page', () => {
    renderComponent({ ...defaultProps, currentPage: 3 });
    const next = screen.getByRole('button', { name: /next page/i });
    expect(next).not.toHaveClass('opacity-40');
  });

  // ── Page number buttons ─────────────────────────────────────

  it('renders page number buttons for all pages when ≤ 7', () => {
    renderComponent({ ...defaultProps, totalPages: 5 });
    for (let i = 1; i <= 5; i++) {
      expect(screen.getByRole('button', { name: String(i) })).toBeInTheDocument();
    }
  });

  it('highlights the current page with active styling', () => {
    renderComponent({ ...defaultProps, currentPage: 3 });
    const active = screen.getByRole('button', { name: '3' });
    expect(active).toHaveClass('bg-navy-850');
    expect(active).toHaveTextContent('3');
  });

  it('non-active pages have border styling', () => {
    renderComponent({ ...defaultProps, currentPage: 2 });
    const inactive = screen.getByRole('button', { name: '1' });
    expect(inactive).toHaveClass('border-slate-300');
  });

  // ── Ellipsis truncation ─────────────────────────────────────

  it('shows ellipsis when there are more than 7 pages and current is near the start', () => {
    renderComponent({ ...defaultProps, totalPages: 20, currentPage: 4 });
    expect(screen.getAllByText('…').length).toBeGreaterThanOrEqual(1);
  });

  it('shows ellipsis when there are more than 7 pages and current is near the end', () => {
    renderComponent({ ...defaultProps, totalPages: 20, currentPage: 17 });
    expect(screen.getAllByText('…').length).toBeGreaterThanOrEqual(1);
  });

  it('always shows page 1 and the last page when truncated', () => {
    renderComponent({ ...defaultProps, totalPages: 20, currentPage: 10 });
    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '20' })).toBeInTheDocument();
  });

  it('shows current page and one neighbor on each side when truncated', () => {
    renderComponent({ ...defaultProps, totalPages: 20, currentPage: 10 });
    expect(screen.getByRole('button', { name: '9' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '10' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '11' })).toBeInTheDocument();
  });

  it('does not show ellipsis when there are ≤ 7 pages', () => {
    renderComponent({ ...defaultProps, totalPages: 7 });
    expect(screen.queryAllByText('…').length).toBe(0);
  });

  // ── onPageChange callbacks ──────────────────────────────────

  it('calls onPageChange with page-1 when Previous is clicked', () => {
    const onPageChange = vi.fn();
    renderComponent({ ...defaultProps, currentPage: 3, onPageChange });
    fireEvent.click(screen.getByRole('button', { name: /previous page/i }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('calls onPageChange with page+1 when Next is clicked', () => {
    const onPageChange = vi.fn();
    renderComponent({ ...defaultProps, currentPage: 3, onPageChange });
    fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    expect(onPageChange).toHaveBeenCalledWith(4);
  });

  it('calls onPageChange with the clicked page number', () => {
    const onPageChange = vi.fn();
    renderComponent({ ...defaultProps, currentPage: 2, onPageChange });
    fireEvent.click(screen.getByRole('button', { name: '4' }));
    expect(onPageChange).toHaveBeenCalledWith(4);
  });

  it('calls onPageChange with page 1 when first page button is clicked', () => {
    const onPageChange = vi.fn();
    renderComponent({ ...defaultProps, currentPage: 10, totalPages: 20, onPageChange });
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('calls onPageChange with last page when last page button is clicked', () => {
    const onPageChange = vi.fn();
    renderComponent({ ...defaultProps, currentPage: 10, totalPages: 20, onPageChange });
    fireEvent.click(screen.getByRole('button', { name: '20' }));
    expect(onPageChange).toHaveBeenCalledWith(20);
  });

  // ── Edge cases ──────────────────────────────────────────────

  it('shows all pages when exactly 7 total', () => {
    renderComponent({ ...defaultProps, totalPages: 7 });
    for (let i = 1; i <= 7; i++) {
      expect(screen.getByRole('button', { name: String(i) })).toBeInTheDocument();
    }
  });

  it('shows all pages when exactly 8 total (triggers truncation)', () => {
    renderComponent({ ...defaultProps, totalPages: 8 });
    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '8' })).toBeInTheDocument();
  });

  it('handles large number of pages without crashing', () => {
    renderComponent({ ...defaultProps, totalPages: 100, currentPage: 50 });
    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '100' })).toBeInTheDocument();
    expect(screen.getAllByText('…').length).toBeGreaterThanOrEqual(1);
  });

  it('shows correct range for single item per page', () => {
    renderComponent({ ...defaultProps, totalItems: 10, pageSize: 1, currentPage: 3 });
    expect(screen.getByText(/Showing 3–3 of 10 entries/)).toBeInTheDocument();
  });

  it('shows correct range when last page has fewer items', () => {
    renderComponent({ ...defaultProps, totalItems: 45, pageSize: 8, currentPage: 6 });
    expect(screen.getByText(/Showing 41–45 of 45 entries/)).toBeInTheDocument();
  });
});
