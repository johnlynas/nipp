'use client';

import { useEffect, useState } from 'react';
import { encryptedFetch } from '@/lib/api-client';

interface LogEntry {
  timestamp: string;
  level: 'error' | 'warn' | 'info';
  source: string;
  message: string;
  details?: string;
}

export default function SystemLogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const res = await encryptedFetch('/api/admin/system-logs?limit=100', { pii: true, cache: 'no-store' });
        if (!res.ok) {
          throw new Error('Failed to fetch logs');
        }
        const data = await res.json();
        setLogs(data.logs);
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

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'error': return 'text-red-600 bg-red-50';
      case 'warn': return 'text-yellow-600 bg-yellow-50';
      case 'info': return 'text-blue-600 bg-blue-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Loading system logs...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">System Logs</h1>
          <p className="mt-1 text-sm text-gray-500">Detailed system error logs for troubleshooting</p>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800 font-medium">Error loading logs</p>
          <p className="text-red-600 text-sm mt-1">{error}</p>
        </div>
      )}

      {/* Logs Container */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        {logs.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-gray-500">No system logs found</p>
            <p className="text-sm text-gray-400 mt-1">Logs will appear here when health checks fail</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {logs.map((log, idx) => (
              <div key={idx} className="p-4 hover:bg-gray-50">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-1 rounded text-xs font-bold uppercase ${getLevelColor(log.level)}`}>
                      {log.level}
                    </span>
                    <span className="text-sm font-mono text-gray-600">
                      {new Date(log.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <span className="text-xs font-semibold text-gray-500">{log.source}</span>
                </div>
                
                <p className="text-sm font-medium text-gray-900 mb-2">{log.message}</p>
                
                {log.details && (
                  <pre className="mt-2 p-3 bg-gray-900 text-gray-100 rounded text-xs overflow-x-auto">
                    <code>{log.details}</code>
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="text-xs text-gray-500 text-center">
        Showing last {logs.length} log entries • Auto-refreshes every 30 seconds
      </div>
    </div>
  );
}
