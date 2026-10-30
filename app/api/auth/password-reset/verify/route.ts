/**
 * GET /api/auth/password-reset/verify -- read-only token pre-flight (design §7.2)
 *
 * The public reset page (/auth/reset-password, Phase 4) calls this on mount to
 * decide loading → form vs invalid state. READ-ONLY by contract: the row is
 * NEVER deleted here — single-use consumption stays in BetterAuth's atomic
 * consumeVerificationValue at reset time (a second POST with the same token
 * still gets INVALID_TOKEN 400). A 429 leaves the token untouched, so a network
 * retry after the window succeeds (magic-link verify precedent).
 *
 * Audit `user.password-reset-link-opened` fires ONLY when valid — that is the
 * one moment we know the token owner's userId; invalid/expired attempts are
 * unattributable by design (no oracle, T10 accepted).
 */
import { NextRequest, NextResponse } from 'next/server';

import { recordAuditLog } from '@/lib/audit-log';
import { AUDIT_ACTION, maskEmail, preFlightResetToken, resetTokenOwnerEmail } from '@/lib/forgot-password';
import { checkPasswordResetRateLimit, getClientIp } from '@/lib/rate-limiter';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);

  if (!checkPasswordResetRateLimit(ip)) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  const token = request.nextUrl.searchParams.get('token') ?? '';
  if (!token) {
    return NextResponse.json({ valid: false, reason: 'missing' });
  }

  try {
    const prefLight = await preFlightResetToken(token);
    if (!prefLight) {
      return NextResponse.json(
        { valid: false, reason: 'invalid-or-expired' },
        { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } },
      );
    }

    // Link-opened audit (valid path only): owner's userId + masked email.
    const email = await resetTokenOwnerEmail(prefLight.userId);
    recordAuditLog({
      userId: prefLight.userId,
      action: AUDIT_ACTION.PASSWORD_RESET_LINK_OPENED,
      resourceType: 'User',
      resourceId: prefLight.userId,
      ipAddress: ip,
      success: true,
      metadata: email ? { maskedEmail: maskEmail(email) } : undefined,
    }).catch((err) => logger.error({ err }, '[ForgotPassword] audit log failed (link opened)'));

    return NextResponse.json(
      {
        valid: true,
        // seconds the token outlives this read — lets the page show a hint;
        // the server is authoritative, this only informs copy.
        expiresInSeconds: Math.max(0, Math.floor((prefLight.expiresAt.getTime() - Date.now()) / 1000)),
      },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } },
    );
  } catch (error) {
    const isDbError = error instanceof Error && error.message.includes("Can't reach database server");
    logger.error(
      { err: error, route: '/api/auth/password-reset/verify', method: 'GET' },
      isDbError ? '[ForgotPassword] Verify endpoint — database unavailable' : '[ForgotPassword] Verify endpoint failed',
    );
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal server error' }, { status: isDbError ? 503 : 500 });
  }
}
