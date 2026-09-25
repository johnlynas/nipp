'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { PageSkeleton } from '@/components/dashboard/PageSkeleton';
import { encryptedFetch } from '@/lib/api-client';

interface LogEntry {
  timestamp: string;
  level: 'error' | 'warn' | 'info';
  source: string;
  message: string;
  details?: string;
}

const LEVEL_STYLES: Record<string, string> = {
  error: 'bg-danger-tint text-danger-ink border border-danger-border',
  warn: 'bg-warning-tint text-warning-ink border border-warning-border',
  info: 'bg-slate-100 text-slate-600',
};

export default function SystemLogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const res = await encryptedFetch('/api/admin/system-logs?limit=100', { pii: true, cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to fetch logs');
        const data = await res.json();
        setLogs(data.logs || []);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    };

    fetchLogs();
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchLogs, 30000);
    return () => clearInterval(interval);
  }, []);

  if (isLoading) {
    return <PageSkeleton rows={7} cols={3} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="System Logs" description="Detailed system error logs for troubleshooting" />

      {/* Error Display */}
      {error && (
        <div className="rounded-lg border border-danger-border bg-danger-tint p-4" role="alert">
          <p className="text-danger-ink font-medium">Error loading logs</p>
          <p className="text-danger-ink/80 text-sm mt-1">{error}</p>
        </div>
      )}

      {/* Logs Container */}
      {!error && (
        <div className="rounded-lg shadow-sm border border-slate-200 bg-white">
          {logs.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-slate-500">No system logs found</p>
              <p className="text-sm text-slate-400 mt-1">Logs will appear here when health checks fail</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {logs.map((log, idx) => (
                <div key={idx} className="p-4 min-w-0 hover:bg-slate-50">
                  <div className="flex justify-between items-start gap-3 mb-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className={`px-2 py-1 rounded text-xs font-bold uppercase ${LEVEL_STYLES[log.level] || LEVEL_STYLES.info}`}>
                        {log.level}
                      </span>
                      <span className="text-sm font-mono text-slate-600 tabular-nums">
                        {new Date(log.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <span className="text-xs font-semibold text-slate-500 truncate">{log.source}</span>
                  </div>

                  <p className="text-sm font-medium text-slate-900 mb-2 break-words">{log.message}</p>

                  {log.details && (
                    <pre className="mt-2 p-3 bg-slate-900 text-slate-100 rounded text-xs overflow-x-auto">
                      <code>{log.details}</code>
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer Info */}
      {!error && (
        <p className="text-xs text-slate-500 text-center">
          Showing last {logs.length} log entries • Auto-refreshes every 30 seconds
        </p>
      )}
    </div>
  );
}
