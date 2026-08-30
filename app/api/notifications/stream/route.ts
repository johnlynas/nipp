/**
 * SSE (Server-Sent Events) Route Handler — Production-ready.
 *
 * Streams notifications to connected clients in real-time:
 * - Health events (DB down, Redis down, pgbouncer issues)
 * - Admin broadcast messages (global or org-specific)
 * - System notifications with priority levels
 *
 * Security:
 *   - Requires valid session authentication (no anonymous access)
 *   - Per-user connection cap: 3 concurrent SSE connections per session
 *   - Global connection cap: 500 total simultaneous connections
 *   - Org-scoped filtering: tenant users only see their org + global; super admins see all
 *   - All connections without valid orgId are rejected (except super admins)
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import globalDb from '@/lib/global-db';
import { addSubscriber, removeSubscriber, getSubscriberCount, getSessionConnectionCount } from '@/lib/notification-push';

// ---------------------------------------------------------------------------
// Configuration — read from env with hardcoded defaults
// ---------------------------------------------------------------------------

const SSE_MAX_CONNECTIONS_PER_USER = Number(process.env.SSE_MAX_CONNECTIONS_PER_USER ?? 3);
const SSE_MAX_GLOBAL_CONNECTIONS = Number(process.env.SSE_MAX_GLOBAL_CONNECTIONS ?? 500);

// ---------------------------------------------------------------------------
// GET — SSE stream endpoint
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  // Authenticate: require valid session
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;
  const sessionId = (session as { id?: string }).id || userId;

  // Check if user is super admin (can see all notifications)
  const isSuperAdmin = (session.user as { isSuperAdmin?: boolean }).isSuperAdmin === true;

  // Determine the user's org context:
  // In Edge Runtime, BetterAuth skips our session callback so activeOrganizationId
  // won't be in the session object. Fetch it from the DB if missing.
  let userOrgId: string | null = (session as { activeOrganizationId?: string }).activeOrganizationId || null;

  if (!userOrgId) {
    const user = await globalDb.user.findUnique({
      where: { id: userId },
      select: { activeOrganizationId: true },
    });
    userOrgId = user?.activeOrganizationId ?? null;
  }

  if (!isSuperAdmin && !userOrgId) {
    return NextResponse.json(
      { error: 'No organization assigned. Please select an organization first.' },
      { status: 403 }
    );
  }

  // Validate orgId query parameter (optional — if provided, must match user's org)
  const url = new URL(request.url);
  const requestedOrgId = url.searchParams.get('orgId');

  if (requestedOrgId) {
    // If user specifies an org, it must match their assigned org (or they're super admin)
    if (!isSuperAdmin && requestedOrgId !== userOrgId) {
      return NextResponse.json(
        { error: 'Access denied to specified organization' },
        { status: 403 }
      );
    }
    userOrgId = requestedOrgId; // Override with requested org for this connection
  }

  // Check global connection cap (cheap O(1) via Map.size)
  const subscriberCount = getSubscriberCount();

  if (subscriberCount >= SSE_MAX_GLOBAL_CONNECTIONS) {
    console.warn(`[SSE] Global connection cap reached (${subscriberCount}/${SSE_MAX_GLOBAL_CONNECTIONS})`);
    return NextResponse.json(
      { error: 'Server is at capacity. Please try again later.' },
      { status: 503 }
    );
  }

  // Check per-user connection cap
  const userConnectionCount = getSessionConnectionCount(sessionId) || 0;
  if (userConnectionCount >= SSE_MAX_CONNECTIONS_PER_USER) {
    console.warn(
      `[SSE] Per-user connection cap reached for session ${sessionId} (${userConnectionCount}/${SSE_MAX_CONNECTIONS_PER_USER})`
    );
    return NextResponse.json(
      { error: 'Too many connections. Please close other tabs or refresh.' },
      { status: 429 }
    );
  }

  // Create a TransformStream for SSE output
  const responseStream = new TransformStream();
  const writer = responseStream.writable.getWriter();
  const encoder = new TextEncoder();
  const connectionId = crypto.randomUUID();

  // Register this subscriber with the notification push service
  const subscriberRegistered = addSubscriber({
    connectionId,
    sessionId,
    userId,
    orgId: userOrgId,
    writer,
    encoder,
  });

  if (!subscriberRegistered) {
    // Cleanup: close the writer if registration failed (shouldn't happen, but safety net)
    try {
      await writer.close();
    } catch (e) {
      // Writer close may fail if already closed — safe to ignore
      void e;
    }
    return NextResponse.json(
      { error: 'Server is at capacity. Please try again later.' },
      { status: 503 }
    );
  }

  // Send initial connection event to the client
  try {
    const connectMessage = `data: {"id":"system","title":"Connected","message":"SSE stream established.","priority":"INFO","source":"sse:connection","createdAt":"${new Date().toISOString()}"}\n\n`;
    await writer.write(encoder.encode(connectMessage));
  } catch (err) {
    // Client disconnected before we could send the initial message
    removeSubscriber(connectionId);
    return new Response('Connection closed', { status: 499 });
  }

  // Handle client disconnection (abort signal)
  request.signal.addEventListener('abort', () => {
    console.debug(`[SSE] Client disconnected: session ${sessionId}`);
    removeSubscriber(connectionId);
    try {
      writer.close();
    } catch (e) {
      // Writer close may fail if already closed — safe to ignore
      void e;
    }
  });

  // Return the SSE response with proper headers
  return new Response(responseStream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      // Prevent browser caching of SSE responses
      'X-Accel-Buffering': 'no', // Nginx compatibility
    },
  });
}

// ---------------------------------------------------------------------------
// Disable caching — SSE is inherently dynamic
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
