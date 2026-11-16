'use client';

import { useEffect, useState } from 'react';
import { Bot, Database, Layers, Network, Plug } from 'lucide-react';
import { PageSkeleton } from '@/components/dashboard/PageSkeleton';
import { apiFetch } from '@/lib/api-client';

// Sources emitted by lib/notification-push.ts — any of these means the
// monitored services changed state and the health card must re-fetch.
const HEALTH_CHECK_SOURCES = new Set([
  'health-check:database',
  'health-check:cache',
  'health-check:pgbouncer',
  'health-check:mcp',
  'health-check:ai-agent',
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
  checks: Record<string, HealthCheck & { total_connections?: number }>;
}

/**
 * Monitored services in display order. `critical` services take the system
 * red when down (red row); non-critical ones only degrade it to amber —
 * the portal keeps running without cache, MCP, or the AI agent server.
 */
const SERVICES: Array<{
  key: 'database' | 'cache' | 'connection-pool' | 'mcp' | 'ai_agent';
  label: string;
  critical: boolean;
  icon: typeof Database;
}> = [
  { key: 'database', label: 'Database', critical: true, icon: Database },
  { key: 'cache', label: 'Cache', critical: false, icon: Layers },
  { key: 'connection-pool', label: 'Connection Pool', critical: true, icon: Network },
  { key: 'mcp', label: 'MCP Server', critical: false, icon: Plug },
  { key: 'ai_agent', label: 'AI Agent', critical: false, icon: Bot },
];

function formatUptime(seconds: number): string {
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
}

export default function SystemHealthCard() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [status, setStatus] = useState<HealthStatus>('loading');

  useEffect(() => {
    let cancelled = false;

    const fetchHealth = async () => {
      try {
        const res = await apiFetch('/api/health', { cache: 'no-store' });
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

  // Whole-card background tracks the overall system state (green / amber / red).
  const cardClasses =
    status === 'healthy'
      ? 'bg-success-tint border-success-border'
      : status === 'degraded'
        ? 'bg-warning-tint border-warning-border'
        : status === 'unhealthy'
          ? 'bg-danger-tint border-danger-border'
          : 'bg-slate-100 border-slate-200';

  const headline =
    status === 'healthy'
      ? 'All systems operational'
      : status === 'degraded'
        ? 'Degraded — non-critical service down'
        : status === 'unhealthy'
          ? 'Critical failure'
          : 'Checking…';

  const headlineClasses =
    status === 'healthy'
      ? 'text-success'
      : status === 'degraded'
        ? 'text-warning-ink'
        : status === 'unhealthy'
          ? 'text-danger-ink'
          : 'text-slate-700';

  if (status === 'loading') {
    return <PageSkeleton rows={3} cols={3} />;
  }

  return (
    <div className={`border rounded-lg shadow-sm ${cardClasses}`}>
      {/* Overall status header */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className={`h-2.5 w-2.5 rounded-full ${
              status === 'healthy'
                ? 'bg-success'
                : status === 'degraded'
                  ? 'bg-warning'
                  : status === 'unhealthy'
                    ? 'bg-danger'
                    : 'bg-slate-500'
            }`}
          />
          <span className={`text-sm font-semibold ${headlineClasses}`}>{headline}</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-600">
          <span>
            Uptime{' '}
            <span className="font-mono tabular-nums">{formatUptime(Math.floor(health?.uptime || 0))}</span>
          </span>
          <span>
            Last checked{' '}
            <span className="font-mono tabular-nums">
              {new Date(health?.timestamp || '').toLocaleTimeString()}
            </span>
          </span>
        </div>
      </div>

      {/* Service rows — green healthy, amber non-critical down, red critical down */}
      <ul className="divide-y divide-slate-200/70 border-t border-slate-200/70">
        {SERVICES.map(({ key, label, critical, icon: Icon }) => {
          const check = health?.checks[key];
          const state = check?.status ?? 'unknown';
          const down = state !== 'healthy' && state !== 'skipped';
          const rowTint = !down
            ? ''
            : critical
              ? 'bg-danger-tint/60'
              : 'bg-warning-tint/60';
          const dotColor = state === 'healthy'
            ? 'bg-success'
            : state === 'skipped'
              ? 'bg-slate-300'
              : critical
                ? 'bg-danger'
                : 'bg-warning';

          return (
            <li key={key} className={`flex items-center gap-3 px-5 py-2.5 ${rowTint}`}>
              <Icon aria-hidden className="h-4 w-4 shrink-0 text-slate-400" />
              <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800">{label}</p>
                {down && check?.error && (
                  <p className={`truncate text-xs ${critical ? 'text-danger-ink' : 'text-warning-ink'}`}>
                    {check.error}
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <p className={`text-sm font-medium ${down ? (critical ? 'text-danger-ink' : 'text-warning-ink') : 'text-slate-700'}`}>
                  {state === 'skipped' ? 'not configured' : state}
                </p>
                {check?.latency_ms !== undefined && (
                  <p className="font-mono text-xs tabular-nums text-slate-500">{check.latency_ms}ms</p>
                )}
                {key === 'connection-pool' && check?.total_connections !== undefined && (
                  <p className="font-mono text-xs tabular-nums text-slate-500">{check.total_connections} conns</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
