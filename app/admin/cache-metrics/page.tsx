'use client';

import { useEffect, useState } from 'react';

interface CacheMetricsData {
  l1Hits: number;
  l1Misses: number;
  l2Hits: number;
  l2Misses: number;
  l1Size: number;
  l1MemoryBytes: number;
  l1HitRate: number;
  redisConnected: boolean;
  timestamp?: string;
}

interface L1Details {
  enabled: boolean;
  maxSize: number;
  maxEntrySize: number;
}

interface CacheMetricsResponse {
  success: boolean;
  data?: {
    metrics: CacheMetricsData;
    l1Details: L1Details;
    timestamp: string;
  };
  error?: string;
}

export default function CacheMetricsPage() {
  const [metrics, setMetrics] = useState<CacheMetricsData | null>(null);
  const [l1Details, setL1Details] = useState<L1Details | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const res = await fetch('/api/cache/metrics', { cache: 'no-store' });
        const data: CacheMetricsResponse = await res.json();

        if (data.success && data.data) {
          setMetrics(data.data.metrics);
          setL1Details(data.data.l1Details);
          setError(null);
        } else {
          setError(data.error || 'Failed to fetch cache metrics');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch cache metrics');
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
    // Poll every 10 seconds for real-time updates
    const interval = setInterval(fetchMetrics, 10000);
    return () => clearInterval(interval);
  }, []);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatNumber = (num: number): string => {
    return num.toLocaleString();
  };

  const getHitRateColor = (rate: number): string => {
    if (rate >= 80) return 'text-green-600';
    if (rate >= 50) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getHitRateBg = (rate: number): string => {
    if (rate >= 80) return 'bg-green-100';
    if (rate >= 50) return 'bg-yellow-100';
    return 'bg-red-100';
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Cache Metrics</h1>
            <p className="mt-1 text-sm text-gray-500">Real-time cache performance monitoring</p>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-center h-64">
            <div className="text-gray-500">Loading cache metrics...</div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Cache Metrics</h1>
            <p className="mt-1 text-sm text-gray-500">Real-time cache performance monitoring</p>
          </div>
        </div>
        <div className="bg-red-50 border-l-4 border-red-500 p-6 rounded-lg">
          <p className="text-red-800">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Cache Metrics</h1>
          <p className="mt-1 text-sm text-gray-500">Real-time cache performance monitoring</p>
        </div>
        <div className="text-sm text-gray-500">
          Last updated: {metrics ? new Date(metrics.timestamp || Date.now()).toLocaleTimeString() : 'N/A'}
        </div>
      </div>

      {/* L1 Cache Status */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">L1 In-Memory Cache</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <p className="text-sm font-medium text-gray-500">Status</p>
            <div className="mt-1 flex items-center">
              {l1Details?.enabled ? (
                <>
                  <span className="inline-block w-2 h-2 bg-green-500 rounded-full mr-2"></span>
                  <span className="text-green-700 font-medium">Active</span>
                </>
              ) : (
                <>
                  <span className="inline-block w-2 h-2 bg-gray-400 rounded-full mr-2"></span>
                  <span className="text-gray-500 font-medium">Disabled</span>
                </>
              )}
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-gray-500">Entries</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">
              {formatNumber(metrics?.l1Size || 0)} / {formatNumber(l1Details?.maxSize || 0)}
            </p>
          </div>

          <div>
            <p className="text-sm font-medium text-gray-500">Memory Usage</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">
              {formatBytes(metrics?.l1MemoryBytes || 0)}
            </p>
          </div>
        </div>

        {/* Hit Rate Progress Bar */}
        <div className="mt-6">
          <div className="flex justify-between items-center mb-2">
            <p className="text-sm font-medium text-gray-500">L1 Hit Rate</p>
            <p className={`text-sm font-bold ${getHitRateColor(metrics?.l1HitRate || 0)}`}>
              {metrics ? metrics.l1HitRate.toFixed(1) : '0'}%
            </p>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div
              className={`h-3 rounded-full transition-all duration-500 ${getHitRateBg(metrics?.l1HitRate || 0)}`}
              style={{ width: `${metrics ? metrics.l1HitRate : 0}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* Cache Performance */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* L1 Cache Performance */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">L1 Cache Performance</h2>
          <div className="space-y-4">
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded">
              <span className="text-sm text-gray-600">Hits</span>
              <span className="text-lg font-bold text-green-600">{formatNumber(metrics?.l1Hits || 0)}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded">
              <span className="text-sm text-gray-600">Misses</span>
              <span className="text-lg font-bold text-red-600">{formatNumber(metrics?.l1Misses || 0)}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded">
              <span className="text-sm text-gray-600">Total Requests</span>
              <span className="text-lg font-bold text-gray-900">
                {formatNumber((metrics?.l1Hits || 0) + (metrics?.l1Misses || 0))}
              </span>
            </div>
          </div>
        </div>

        {/* L2 (Redis) Performance */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">L2 Cache (Redis) Performance</h2>
          <div className="space-y-4">
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded">
              <span className="text-sm text-gray-600">Hits</span>
              <span className="text-lg font-bold text-green-600">{formatNumber(metrics?.l2Hits || 0)}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded">
              <span className="text-sm text-gray-600">Misses</span>
              <span className="text-lg font-bold text-red-600">{formatNumber(metrics?.l2Misses || 0)}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded">
              <span className="text-sm text-gray-600">Redis Status</span>
              <div className="flex items-center">
                {metrics?.redisConnected ? (
                  <>
                    <span className="inline-block w-2 h-2 bg-green-500 rounded-full mr-2"></span>
                    <span className="text-green-700 font-medium">Connected</span>
                  </>
                ) : (
                  <>
                    <span className="inline-block w-2 h-2 bg-red-500 rounded-full mr-2"></span>
                    <span className="text-red-700 font-medium">Disconnected</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Cache Configuration */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Cache Configuration</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <p className="text-sm font-medium text-gray-500">Max Entries</p>
            <p className="mt-1 text-lg font-bold text-gray-900">{formatNumber(l1Details?.maxSize || 0)}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Max Entry Size</p>
            <p className="mt-1 text-lg font-bold text-gray-900">{formatBytes(l1Details?.maxEntrySize || 0)}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">TTL Type</p>
            <p className="mt-1 text-lg font-bold text-gray-900">Adaptive</p>
          </div>
        </div>
      </div>

      {/* Cache Warming Status */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Cache Warming</h2>
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            On application startup, the L1 cache is pre-populated with frequently accessed data:
          </p>
          <ul className="text-sm text-gray-600 space-y-1 ml-4 list-disc">
            <li>Organizations (all)</li>
            <li>Users (all)</li>
            <li>Roles (per organization)</li>
            <li>Permissions (master catalog)</li>
          </ul>
          <p className="text-xs text-gray-500 mt-2">
            These entries are marked as "permanent" — they have no TTL and will only be evicted if explicitly deleted.
          </p>
        </div>
      </div>
    </div>
  );
}
