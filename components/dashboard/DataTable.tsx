'use client';

import { PageSkeleton } from './PageSkeleton';

interface Column<T> {
  key: string;
  label: string;
  render?: (item: T) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: Array<Column<T>>;
  data: T[];
  loading?: boolean;
  emptyMessage?: string;
  /** Stable row identity — avoids key={idx} reflow/ordering bugs on filtered lists */
  rowKey?: (item: T) => string | number;
}

export function DataTable<T>({ columns, data, loading, emptyMessage = 'No results found', rowKey }: DataTableProps<T>) {
  if (loading) {
    return <PageSkeleton rows={6} cols={columns.length} />;
  }

  const keyOf = (item: T, idx: number): string | number => {
    if (rowKey) return rowKey(item);
    const rec = item as unknown as Record<string, unknown>;
    const v = rec.id ?? rec._id ?? rec.key;
    return v != null ? String(v) : String(idx);
  };

  if (data.length === 0) {
    return <div className="py-8 text-center text-slate-500">{emptyMessage}</div>;
  }

  const cell = (col: Column<T>, item: T) =>
    col.render ? col.render(item) : String((item as unknown as Record<string, unknown>)[col.key] ?? '');

  return (
    <div>
      {/* Stacked row layout — narrow screens: every column gets a labelled line */}
      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white sm:hidden">
        {data.map((item, idx) => (
          <div key={keyOf(item, idx)} className="p-4" style={{ color: 'var(--color-slate-900)' }}>
            <dl className="space-y-2">
              {columns.map((col) => (
                <div key={col.key} className="flex items-baseline justify-between gap-4 text-sm min-w-0">
                  <dt className="shrink-0 text-xs font-medium uppercase tracking-wide text-slate-500">{col.label}</dt>
                  <dd className="min-w-0 text-left sm:text-right break-words">{cell(col, item)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>

      {/* Table — sm and up */}
      <div className="hidden overflow-x-auto rounded border border-slate-200 sm:block">
        <table className="min-w-full divide-y divide-slate-200">
          <thead>
            <tr className="bg-canvas-subtle">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500"
                  scope="col"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {data.map((item, idx) => (
              <tr key={keyOf(item, idx)} className="hover:bg-slate-50 transition-colors">
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-3 text-sm" style={{ color: 'var(--color-slate-900)' }}>
                    {cell(col, item)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
