/**
 * Unit tests for checkRemoteService — the remote health endpoint probe used
 * for the MCP server and AI agent server (non-critical, amber when down).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Health-check pulls in DB/Redis/PgBouncer at module scope; none of that is
// exercised by checkRemoteService, so mock the heavy dependencies away.
vi.mock('@/lib/tenant-db', () => ({ default: { $queryRaw: vi.fn() } }));
vi.mock('@/lib/redis', () => ({ getRedis: vi.fn(() => null) }));
vi.mock('@/lib/system-logs', () => ({ updateHealthState: vi.fn() }));
vi.mock('@/lib/pgbouncer-monitor', () => ({ PgBouncerMonitor: vi.fn() }));
vi.mock('@/lib/env', () => ({ env: { MCP_HEALTH_URL: 'http://mcp/health', AI_AGENT_HEALTH_URL: 'http://agent/health' } }));

import { checkRemoteService } from '@/lib/health-check';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe('checkRemoteService', () => {
  it('reports healthy when the endpoint returns 2xx with status=healthy', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { status: 'healthy', uptime: 100 }));

    const result = await checkRemoteService('http://mcp/health');

    expect(result.status).toBe('healthy');
    expect(typeof result.latency_ms).toBe('number');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://mcp/health',
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    );
  });

  it('reports healthy (with a note) when the endpoint is degraded — process up, dependency down', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {
      status: 'degraded',
      checks: { portal: { status: 'unhealthy', error: 'Portal unreachable (fetch failed)' } },
    }));

    const result = await checkRemoteService('http://agent/health');

    expect(result.status).toBe('healthy');
    expect(result.message).toContain('degraded');
    expect(result.message).toContain('portal');
  });

  it('reports unhealthy when the endpoint self-reports an unhealthy status, with dependency details', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(503, {
      status: 'unhealthy',
      checks: { storage: { status: 'unhealthy', error: 'Storage query failed (timeout)' } },
    }));

    const result = await checkRemoteService('http://agent/health');

    expect(result.status).toBe('unhealthy');
    expect(result.error).toContain('HTTP 503');
    expect(result.error).toContain('storage');
  });

  it('reports unhealthy when a 2xx body self-reports status=unhealthy', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {
      status: 'unhealthy',
      checks: { portal: { status: 'unhealthy', error: 'Portal unreachable (fetch failed)' } },
    }));

    const result = await checkRemoteService('http://agent/health');

    expect(result.status).toBe('unhealthy');
    expect(result.error).toContain('"unhealthy"');
    expect(result.error).toContain('portal');
  });

  it('reports unhealthy on non-2xx responses with the HTTP status', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(503, {}));

    const result = await checkRemoteService('http://mcp/health');

    expect(result.status).toBe('unhealthy');
    expect(result.error).toBe('HTTP 503');
  });

  it('reports unhealthy on network failure with the reason', async () => {
    fetchMock.mockRejectedValueOnce(new Error('fetch failed'));

    const result = await checkRemoteService('http://mcp/health');

    expect(result.status).toBe('unhealthy');
    expect(result.error).toContain('Request failed');
    expect(result.error).toContain('fetch failed');
  });

  it('reports unhealthy on malformed (non-JSON) bodies', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('not json');
      },
    });

    const result = await checkRemoteService('http://mcp/health');

    expect(result.status).toBe('unhealthy');
    expect(result.error).toContain('Invalid JSON response');
  });

  it('reports unhealthy when the body has no status field', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { uptime: 5 }));

    const result = await checkRemoteService('http://mcp/health');

    expect(result.status).toBe('unhealthy');
    expect(result.error).toContain('no status field');
  });
});
