'use client';

/**
 * PageSkeleton — consistent table-loading placeholder.
 * Replaces bare "Loading..." strings: same height as a data table,
 * slate shimmer bars so the eye reads "rows are coming", no spinner noise.
 */
export function PageSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="overflow-hidden rounded-lg border border-slate-200 bg-white"
    >
      <div className="border-b border-slate-200 bg-canvas-subtle px-4 py-3">
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="h-3 animate-pulse rounded bg-slate-200" />
        ))}
      </div>
      <div className="divide-y divide-slate-100">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-6 px-4 py-4" style={{ opacity: 1 - r * 0.15 }}>
            {Array.from({ length: cols }).map((_, c) => (
              <div
                key={c}
                className="h-3 animate-pulse rounded bg-slate-200/80"
                style={{ width: `${[22, 34, 26, 18, 12][c % 5]}%` }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
