'use client';

import { useEffect, useState } from 'react';
import { PageSkeleton } from '@/components/dashboard/PageSkeleton';

// Sources emitted by lib/notification-push.ts — any of these means the
// monitored services changed state and the health card must re-fetch.
const HEALTH_CHECK_SOURCES = new Set([
  'health-check:database',
  'health-check:cache',
  'health-check:pgbouncer',
]);

type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'loading';

interface HealthCheck {
  status: string;
  latency_ms?: number;
  error?: string;
}

interface HealthData {
  status: HealthStatus;
  timestamp: string;
  uptime: number;
  checks: {
    database: HealthCheck;
    cache: HealthCheck;
    "connection-pool"?: HealthCheck & { total_connections?: number };
  };
}

export default function SystemHealthCard() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [status, setStatus] = useState<HealthStatus>('loading');

  useEffect(() => {
    let cancelled = false;

    const fetchHealth = async () => {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        const data = await res.json();
        if (cancelled) return;
        setHealth(data);
        setStatus(data.status);
      } catch {
        if (!cancelled) setStatus('unhealthy');
      }
    };

    fetchHealth();

    // Safety-net polling (the SSE feed is the primary refresh path)
    const interval = setInterval(fetchHealth, 60000);

    // Live updates: when any health check notifies a state change over SSE
    // (pushed by /api/health via notifyHealthCheck), re-fetch immediately.
    // The singleton useNotifications connection mirrors every SSE message to
    // a 'sse-notification' CustomEvent; we filter to health-check sources.
    const onNotification = (event: Event) => {
      const { detail } = event as { detail?: { source?: string | null } };
      if (detail?.source && HEALTH_CHECK_SOURCES.has(detail.source)) {
        fetchHealth();
      }
    };
    window.addEventListener('sse-notification', onNotification);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('sse-notification', onNotification);
    };
  }, []);

  const getStatusColor = () => {
    if (status === 'healthy') return 'bg-success-tint border-success-border text-success';
    if (status === 'degraded') return 'bg-warning-tint border-warning-border text-warning-ink';
    if (status === 'unhealthy') return 'bg-danger-tint border-danger-border text-danger-ink';
    return 'bg-slate-100 border-slate-200 text-slate-700';
  };

  const getStatusDot = () => {
    if (status === 'healthy') return 'bg-success';
    if (status === 'degraded') return 'bg-warning-ink';
    if (status === 'unhealthy') return 'bg-danger';
    return 'bg-slate-500';
  };

  const formatUptime = (seconds: number): string => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

    return parts.join(' ');
  };

  if (status === 'loading') {
    return <PageSkeleton rows={3} cols={3} />;
  }

  return (
    <div className={`p-6 border rounded-lg shadow-sm ${getStatusColor()} flex items-start gap-3`}>
      <span className={`mt-1 h-2.5 w-2.5 rounded-full shrink-0 ${getStatusDot()}`} aria-hidden />
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center mb-4">
          <span className="text-sm font-mono">Uptime: {formatUptime(Math.floor(health?.uptime || 0))}</span>
        </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <p className="text-xs font-semibold opacity-75">Database</p>
          <p className="font-medium">{health?.checks.database.status}</p>
          {health?.checks.database.latency_ms !== undefined && (
            <p className="text-xs opacity-75">{health.checks.database.latency_ms}ms</p>
          )}
          {health?.checks.database.error && (
            <p className="text-xs text-danger-ink mt-1">{health.checks.database.error}</p>
          )}
        </div>

        <div>
          <p className="text-xs font-semibold opacity-75">Cache</p>
          <p className="font-medium">{health?.checks.cache.status}</p>
          {health?.checks.cache.latency_ms !== undefined && (
            <p className="text-xs opacity-75">{health.checks.cache.latency_ms}ms</p>
          )}
          {health?.checks.cache.error && (
            <p className="text-xs text-danger-ink mt-1">{health.checks.cache.error}</p>
          )}
        </div>

        <div>
          <p className="text-xs font-semibold opacity-75">Database Connection Pool</p>
          <p className="font-medium">{health?.checks["connection-pool"]?.status || 'skipped'}</p>
          {health?.checks["connection-pool"]?.latency_ms !== undefined && (
            <p className="text-xs opacity-75">{health.checks["connection-pool"].latency_ms}ms</p>
          )}
          {health?.checks["connection-pool"]?.total_connections !== undefined && (
            <p className="text-xs opacity-75">{health.checks["connection-pool"].total_connections} conns</p>
          )}
          {health?.checks["connection-pool"]?.error && (
            <p className="text-xs text-danger-ink mt-1">{health.checks["connection-pool"].error}</p>
          )}
        </div>
      </div>

      <p className="text-xs opacity-75 mt-4">Last checked: {new Date(health?.timestamp || '').toLocaleTimeString()}</p>
    </div>
    </div>
  );
}
