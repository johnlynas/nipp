/**
 * POST /api/auth/password-reset/reset -- complete the password reset (design §7.3)
 *
 * Public, session-less mutation: body { newPassword, token }. Order is a
 * contract — rate limit → shape validation → pre-flight row lookup (the single
 * place we learn the ownerId BEFORE BetterAuth; gives us userId/email for the
 * guard + ban re-check + audit when BetterAuth's INVALID_TOKEN error has none)
 * → credential-only guard (T5: a forged body cannot re-arm an OIDC-only account)
 * → ban re-check at mutation time (a ban issued after the token was emailed
 * must not go stale) → BetterAuth's stock `resetPassword` IN-PROCESS via
 * auth.api.resetPassword (plan R1): scrypt hash, credential Account row write,
 * onPasswordReset observer and the atomic Verification delete all stay
 * single-sourced there.
 *
 * Length rules: >72 chars is pre-rejected with /api/auth/password's exact copy
 * so the scrypt ceiling can never surface as a raw BetterAuth error; the floor
 * (minPasswordLength) comes from BetterAuth itself, surfaced verbatim (400).
 * Replay of a consumed token → 400 'Invalid or expired reset link.' (no 4xx
 * distinction between invalid and replay — no oracle). Response is no-store.
 */
import { NextRequest, NextResponse } from 'next/server';

import { auth, enforceBanStatus } from '@/lib/auth';
import { APIError } from 'better-auth/api';
import { recordAuditLog } from '@/lib/audit-log';
import { AUDIT_ACTION, hasCredentialAccount, maskEmail, preFlightResetToken, resetTokenOwnerEmail } from '@/lib/forgot-password';
import { checkPasswordResetRateLimit, getClientIp } from '@/lib/rate-limiter';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Same copy as /api/auth/password — the scrypt input ceiling. */
const SCRYPT_MAX_LENGTH = 72;

function authErrorStatus(err: unknown): number {
  if (err instanceof APIError) return err.statusCode;
  return err instanceof Error && errorDbUnavailable(err.message) ? 503 : 500;
}

function errorDbUnavailable(message: string): boolean {
  return message.includes("Can't reach database server");
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);

  if (!checkPasswordResetRateLimit(ip)) {
    logger.warn({ route: '/api/auth/password-reset/reset', method: 'POST' }, 'Password reset completion rate limited');
    return NextResponse.json(
      { error: 'Too many requests — try again in a minute.' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  let body: { newPassword?: unknown; token?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
  const token = typeof body.token === 'string' ? body.token.trim() : '';

  if (!newPassword) return NextResponse.json({ error: 'A new password is required.' }, { status: 400 });
  if (!token) return NextResponse.json({ error: 'A reset token is required.' }, { status: 400 });
  if (newPassword.length > SCRYPT_MAX_LENGTH) {
    return NextResponse.json({ error: `Password must be at most ${SCRYPT_MAX_LENGTH} characters.` }, { status: 400 });
  }

  try {
    // Pre-flight = the ONLY point where the token's owner is known ahead of
    // BetterAuth (its INVALID_TOKEN error carries no userId — needed for the
    // guards below and for a meaningful audit on the failure path).
    const preLight = await preFlightResetToken(token);
    if (!preLight) {
      logger.info({ route: '/api/auth/password-reset/reset', tokenPresent: true }, '[ForgotPassword] Reset rejected — invalid or expired link (no oracle detail leaked)');
      return NextResponse.json(
        { error: 'Invalid or expired reset link.' },
        { status: 400, headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } },
      );
    }

    const email = await resetTokenOwnerEmail(preLight.userId);
    if (!email) {
      // Token owner vanished between issue and reset — reject, never hand out a 500.
      return NextResponse.json(
        { error: 'Invalid or expired reset link.' },
        { status: 400, headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } },
      );
    }

    if (!(await hasCredentialAccount(preLight.userId))) {
      logger.warn(
        { userId: preLight.userId },
        'Rejected password reset for an OIDC-only account (server-side T5 guard)',
      );
      return NextResponse.json(
        { error: 'Password resets are only available for email & password accounts.' },
        { status: 403 },
      );
    }

    // Ban re-check AT mutation time — a ban issued after the email was sent
    // must not be bypassed by a stale-in-flight token (T4).
    await enforceBanStatus(email);

    const result = await auth.api.resetPassword({
      body: { newPassword, token },
      headers: new Headers({ host: new URL(request.url).host }),
    });

    // Success audit — masked email only (Q5), full userId (we own this row).
    recordAuditLog({
      userId: preLight.userId,
      action: AUDIT_ACTION.PASSWORD_RESET_SUCCESS,
      resourceType: 'User',
      resourceId: preLight.userId,
      ipAddress: ip,
      success: true,
      metadata: { maskedEmail: maskEmail(email) },
    }).catch((err) => logger.error({ err }, '[ForgotPassword] audit log failed (reset success)'));

    return NextResponse.json(
      { success: Boolean(result.status), message: 'Password updated' },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } },
    );
  } catch (error) {
    const status = authErrorStatus(error);
    // APIErrors are BetterAuth's own validation copy (PASSWORD_TOO_SHORT,
    // INVALID_TOKEN on a replay that beat the pre-flight, …) — surface them.
    const message =
      error instanceof APIError
        ? error.message
        : status === 503
          ? 'Database unavailable'
          : 'Internal server error';
    logger.error(
      { err: error, route: '/api/auth/password-reset/reset', method: 'POST', status },
      '[ForgotPassword] Reset endpoint failed',
    );
    return NextResponse.json(
      { error: message },
      { status, headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } },
    );
  }
}
