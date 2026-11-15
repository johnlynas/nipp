import { CpuAi } from 'lucide-react';
import { headers } from 'next/headers';

/**
 * Admin Agent — embeds the portal AI agent's chat interface (mastra-nipp-agent,
 * default http://localhost:3001/chat) in a full-bleed frame. The URL comes from
 * NIPP_AGENT_URL (server-side only). If the agent is not running and cannot be
 * reached, the page shows an unavailable state instead of a blank frame.
 *
 * Auth (server-to-server bearer): the caller's live portal session token is
 * appended to the iframe URL as ?agentToken=*** The agent's /api/session and
 * /api/chat accept `Authorization: Bearer <token>` (better-auth bearer plugin,
 * shared BETTER_AUTH_SECRET) — no cross-origin cookies involved. This is what
 * makes the embed work in production mode, where the portal's session cookie
 * carries the __Secure- prefix that the agent's better-auth instance does not
 * read over plain HTTP. The token lives only in this page's server-rendered
 * HTML (never in a client-side store) and is single-use per iframe load.
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

/** The caller's portal session token (cookie value — the same signed value the
 *  bearer plugin verifies against BETTER_AUTH_SECRET). Null when absent. */
async function getSessionToken(): Promise<string | null> {
  const h = await headers();
  const cookieHeader = h.get('cookie') ?? '';
  for (const name of [
    '__Secure-better-auth.session_token',
    'better-auth.session_token',
    '__Secure-better-auth-session_token',
    'better-auth-session_token',
  ]) {
    for (const part of cookieHeader.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
    }
  }
  return null;
}

export default async function AdminAgentPage() {
  const [reachable, token] = await Promise.all([isAgentReachable(AGENT_URL), getSessionToken()]);

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

  const embedUrl = new URL(AGENT_URL);
  if (token) embedUrl.searchParams.set('agentToken', token);

  return (
    <iframe
      src={embedUrl.toString()}
      title="Portal AI Agent chat"
      className="h-full w-full border-0"
      allow="clipboard-write"
    />
  );
}
