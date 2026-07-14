'use client';

import { useEffect, useState } from 'react';

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
  };
}

export default function SystemHealthCard() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [status, setStatus] = useState<HealthStatus>('loading');

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        const data = await res.json();
        setHealth(data);
        setStatus(data.status);
      } catch (error) {
        setStatus('unhealthy');
      }
    };

    fetchHealth();
    // Poll every 60 seconds
    const interval = setInterval(fetchHealth, 60000);
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = () => {
    if (status === 'healthy') return 'bg-green-100 border-green-500 text-green-800';
    if (status === 'degraded') return 'bg-yellow-100 border-yellow-500 text-yellow-800';
    if (status === 'unhealthy') return 'bg-red-100 border-red-500 text-red-800';
    return 'bg-gray-100 border-gray-500 text-gray-800';
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
    return <div className="p-4 border rounded-lg bg-gray-50">Loading system health...</div>;
  }

  return (
    <div className={`p-6 border-l-4 rounded-lg shadow-sm ${getStatusColor()}`}>
      <div className="flex justify-between items-center mb-4">
        <span className="text-sm font-mono">Uptime: {formatUptime(Math.floor(health?.uptime || 0))}</span>
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-semibold opacity-75">Database</p>
          <p className="font-medium">{health?.checks.database.status}</p>
          {health?.checks.database.latency_ms !== undefined && (
            <p className="text-xs opacity-75">{health.checks.database.latency_ms}ms</p>
          )}
          {health?.checks.database.error && (
            <p className="text-xs text-red-600 mt-1">{health.checks.database.error}</p>
          )}
        </div>
        
        <div>
          <p className="text-xs font-semibold opacity-75">Cache</p>
          <p className="font-medium">{health?.checks.cache.status}</p>
          {health?.checks.cache.latency_ms !== undefined && (
            <p className="text-xs opacity-75">{health.checks.cache.latency_ms}ms</p>
          )}
          {health?.checks.cache.error && (
            <p className="text-xs text-red-600 mt-1">{health.checks.cache.error}</p>
          )}
        </div>
      </div>
      
      <p className="text-xs opacity-75 mt-4">Last checked: {new Date(health?.timestamp || '').toLocaleTimeString()}</p>
    </div>
  );
}
