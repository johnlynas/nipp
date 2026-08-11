'use client';

interface DataTableProps<T> {
  columns: Array<{ key: string; label: string; render?: (item: T) => React.ReactNode }>;
  data: T[];
  loading?: boolean;
  emptyMessage?: string;
}

export function DataTable<T>({ columns, data, loading, emptyMessage = 'No results found' }: DataTableProps<T>) {
  if (loading) {
    return <div className="py-8 text-center" style={{ color: '#6c757d' }}>Loading...</div>;
  }

  if (data.length === 0) {
    return <div className="py-8 text-center" style={{ color: '#6c757d' }}>{emptyMessage}</div>;
  }

  return (
    <div className="overflow-x-auto rounded border" style={{ borderColor: '#dee2e6' }}>
      <table className="min-w-full divide-y" style={{ borderColor: '#dee2e6' }}>
        <thead>
          <tr className="bg-[#1B2A4A]">
            {columns.map((col) => (
              <th
                key={col.key}
                className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-white"
                scope="col"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y bg-white" style={{ borderColor: '#dee2e6' }}>
          {data.map((item, idx) => (
            <tr key={idx} className="hover:bg-gray-50 transition-colors">
              {columns.map((col) => (
                <td key={col.key} className="px-4 py-3 text-sm">
                  {col.render ? col.render(item) : String((item as Record<string, unknown>)[col.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
