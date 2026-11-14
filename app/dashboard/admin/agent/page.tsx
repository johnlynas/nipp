import { CpuAi } from 'lucide-react';

/**
 * Admin Agent — embeds the portal AI agent's chat interface (mastra-nipp-agent,
 * default http://localhost:3001/chat) in a full-bleed frame. The URL comes from
 * NIPP_AGENT_URL (server-side only). If the agent is not running and cannot be
 * reached, the page shows an unavailable state instead of a blank frame.
 */

export const dynamic = 'force-dynamic';

const AGENT_URL = process.env.NIPP_AGENT_URL ?? 'http://localhost:3001/chat';

/** Probe the agent with a short timeout — one request per page load. */
async function isAgentReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
      redirect: 'follow',
    });
    return res.ok;
  } catch {
    return false;
  }
}

export default async function AdminAgentPage() {
  const reachable = await isAgentReachable(AGENT_URL);

  if (!reachable) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <CpuAi className="h-10 w-10" style={{ color: 'var(--color-slate-400)' }} aria-hidden="true" />
          <p className="text-lg font-semibold" style={{ color: 'var(--color-navy-850)' }}>
            AI Agent is not available
          </p>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-slate-500)' }}>
            The agent service at <code className="rounded bg-canvas-subtle px-1.5 py-0.5 text-xs">{AGENT_URL}</code>{' '}
            could not be reached. Start the agent (e.g. <code className="rounded bg-canvas-subtle px-1.5 py-0.5 text-xs">npm run dev</code> in{' '}
            mastra-nipp-agent) and reload this page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <iframe
      src={AGENT_URL}
      title="Portal AI Agent chat"
      className="h-full w-full border-0"
      allow="clipboard-write"
    />
  );
}
