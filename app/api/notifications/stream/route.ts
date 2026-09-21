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
 *
 * Stream implementation notes (why it's shaped this way):
 *   The response is backed by a native web ReadableStream via
 *   `controller.enqueue()`. This is the safe primitive for Next.js route
 *   handlers: enqueue resolves immediately regardless of whether a consumer
 *   is attached, so writes BEFORE returning the Response would never deadlock
 *   (the classic TransformStream `await writer.write()` hang), and aborting
 *   clients are handled cleanly without Node-stream↔web-stream bridging that
 *   throws uncaught ERR_INVALID_STATE on disconnect.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
// RLS Phase 3: User has no RLS policy — bind a platform context (verified session).
import tenantDb from '@/lib/tenant-db';
import { withPlatformContext } from '@/lib/platform-db';
import { addSubscriber, removeSubscriber, getSubscriberCount, getSessionConnectionCount } from '@/lib/notification-push';

// ---------------------------------------------------------------------------
// Configuration — read from env with hardcoded defaults
// ---------------------------------------------------------------------------

const SSE_MAX_CONNECTIONS_PER_USER = Number(process.env.SSE_MAX_CONNECTIONS_PER_USER ?? 3);
const SSE_MAX_GLOBAL_CONNECTIONS = Number(process.env.SSE_MAX_GLOBAL_CONNECTIONS ?? 500);

/**
 * If a client falls this far behind (bytes) we drop it instead of letting the
 * in-memory buffer grow unbounded. desiredSize < 0 means the stream is at
 * least |desiredSize| bytes over its highWaterMark.
 */
const MAX_STREAM_BACKLOG_BYTES = 1024 * 1024; // 1 MiB

export type SseControllerHolder = { controller: ReadableStreamDefaultController<Uint8Array> | null };

/**
 * Enqueue an SSE chunk without ever blocking or throwing on a dead client.
 * Returns false if the stream is closed/errored (client gone).
 */
function enqueueSse(holder: SseControllerHolder, chunk: Uint8Array, onClose: () => void): boolean {
  const controller = holder.controller;
  if (!controller) return false;

  try {
    // desiredSize === null → stream already closing/errored.
    if (controller.desiredSize === null) {
      return false;
    }

    // Drop runaway slow clients before enqueueing unbounded backlog.
    if (controller.desiredSize < -MAX_STREAM_BACKLOG_BYTES) {
      onClose();
      try {
        controller.error(new Error('SSE client fell behind — connection closed'));
      } catch {
        /* stream may already be dead */
      }
      return false;
    }

    controller.enqueue(chunk);
    return true;
  } catch {
    // Controller already closed/errored between the check and the enqueue.
    return false;
  }
}

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
    const user = await withPlatformContext(userId, () =>
      tenantDb.user.findUnique({
        where: { id: userId },
        select: { activeOrganizationId: true },
      }),
    );
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

  const encoder = new TextEncoder();
  const connectionId = crypto.randomUUID();
  let closed = false;

  /** Idempotent teardown: unsubscribe + end the stream, safe to call repeatedly. */
  const closeConnection = (): void => {
    if (closed) return;
    closed = true;
    removeSubscriber(connectionId);
    try {
      holder.controller?.close();
    } catch {
      // Stream already errored/closed — nothing to do
    }
  };

  const holder: SseControllerHolder = { controller: null };
  const responseStream = new ReadableStream<Uint8Array>({
    start(controller) {
      holder.controller = controller;
    },
    cancel() {
      // Client went away without an abort signal (or Next cancelled the stream).
      closeConnection();
    },
  });

  const writeBytes = (chunk: Uint8Array): boolean => enqueueSse(holder, chunk, closeConnection);

  // Writer shim matching the web WritableStreamDefaultWriter shape that
  // lib/notification-push.ts expects. Only `write`/`close` are ever invoked.
  const writer = new Proxy({} as WritableStreamDefaultWriter<Uint8Array>, {
    get(_t, prop: string) {
      if (prop === 'write') {
        return (value: Uint8Array): Promise<void> =>
          writeBytes(value) ? Promise.resolve() : Promise.reject(new Error('SSE stream closed'));
      }
      if (prop === 'close' as string || prop === 'releaseLock') {
        return (): void | Promise<void> => closeConnection();
      }
      if (prop === 'abort') {
        return (): void | Promise<void> => closeConnection();
      }
      // Untouched shape members (ready/closed/desiredSize) are never read by the push service.
      return undefined;
    },
  });

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
    closeConnection();
    return NextResponse.json(
      { error: 'Server is at capacity. Please try again later.' },
      { status: 503 }
    );
  }

  // Send initial connection event to the client (enqueue — never deadlocks).
  const connectMessage = `data: {"id":"system","title":"Connected","message":"SSE stream established.","priority":"INFO","source":"sse:connection","createdAt":"${new Date().toISOString()}"}\n\n`;

  if (!writeBytes(encoder.encode(connectMessage))) {
    closeConnection();
    return new Response('Connection closed', { status: 499 });
  }

  // Handle client disconnection (abort signal) — idempotent cleanup
  request.signal.addEventListener('abort', () => {
    console.debug(`[SSE] Client disconnected: session ${sessionId}`);
    closeConnection();
  });

  // Return the SSE response with proper headers
  return new Response(responseStream, {
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
