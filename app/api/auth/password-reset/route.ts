/**
 * POST /api/auth/password-reset -- request a password reset email (local users)
 *
 * Public, session-less, IP-rate-limited on the dedicated `password-reset` tier
 * (5/min — separate store from the sign-in auth tier). Wraps BetterAuth's stock
 * `requestPasswordReset` handler IN-PROCESS via `auth.api.requestPasswordReset`
 * (plan R1 decision: no internal fetch to the catch-all, so there is no double
 * rate-limit count; token generation + Verification row + the sendResetPassword
 * email hook all stay single-sourced in BetterAuth).
 *
 * Copy discipline (design §7.1): both unknown and known emails get the IDENTICAL
 * 200 `{ status: true, message }` pass-through — no account oracle. BetterAuth
 * also equalises timing for unknown emails built-in. The ban gate runs BEFORE
 * handing to BetterAuth (T4/Q1): an active ban is a hard 401 with the login
 * banner's copy. Audit uses maskEmail output only (Q5).
 */
import { NextRequest, NextResponse } from 'next/server';

import { auth, enforceBanStatus } from '@/lib/auth';
import { APIError } from 'better-auth/api';
import { recordAuditLog } from '@/lib/audit-log';
import { AUDIT_ACTION, maskEmail } from '@/lib/forgot-password';
import { checkPasswordResetRateLimit, getClientIp } from '@/lib/rate-limiter';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Map a BetterAuth APIError to its HTTP status (statusCode: 400/401/…). */
function authErrorStatus(err: unknown): number {
  if (err instanceof APIError) return err.statusCode;
  const m = err instanceof Error ? /Can't reach database server/.test(err.message) : false;
  return m ? 503 : 500;
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);

  // Tier first — a throttled client never touches the DB (magic-link precedent).
  if (!checkPasswordResetRateLimit(ip)) {
    logger.warn({ route: '/api/auth/password-reset', method: 'POST' }, 'Password reset request rate limited');
    return NextResponse.json(
      { error: 'Too many requests — try again in a minute.' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
  }

  try {
    // Ban gate BEFORE BetterAuth (design T4, Q1): a banned local user must not
    // re-arm their own inbox with reset tokens; expiry lifting stays in
    // enforceBanStatus' single implementation. It throws APIError('UNAUTHORIZED')
    // — mapped to 401 below with its own 'Access denied…' banner copy intact.
    await enforceBanStatus(email);

    // In-process call — host header carries the request origin so the Phase 2
    // sendResetPassword hook builds the emailed link where the user asked from.
    const result = await auth.api.requestPasswordReset({
      body: { email },
      headers: new Headers({ host: new URL(request.url).host }),
    });

    // Fire-and-forget audit (no session — userId only known for real accounts;
    // never reveal that distinction in the response). Masked email only (Q5).
    recordAuditLog({
      action: AUDIT_ACTION.PASSWORD_RESET_REQUESTED,
      resourceType: 'User',
      resourceId: null,
      ipAddress: ip,
      success: true,
      metadata: { maskedEmail: maskEmail(email) },
    }).catch((err) => logger.error({ err }, '[ForgotPassword] audit log failed (reset request)'));

    // Pass BetterAuth's idempotent body through verbatim — the no-oracle copy.
    return NextResponse.json(
      { status: result.status, message: result.message },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } },
    );
  } catch (error) {
    const status = authErrorStatus(error);
    // Surface BetterAuth's own copy for APIErrors (ban → 'Access denied…',
    // length/field validation, …); everything else is internal.
    const message =
      error instanceof APIError
        ? error.message
        : status === 503
          ? 'Database unavailable'
          : 'Internal server error';
    logger.error(
      { err: error, route: '/api/auth/password-reset', method: 'POST', status },
      '[ForgotPassword] Request endpoint failed',
    );
    return NextResponse.json({ error: message }, { status });
  }
}
