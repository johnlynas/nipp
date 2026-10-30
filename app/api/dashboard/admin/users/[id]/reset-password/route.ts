/**
 * POST /api/dashboard/admin/users/[id]/reset-password — admin-initiated reset
 *
 * Super-admin only. Re-arms the SAME inbox-proven flow a local user would start
 * from "Forgot password?": in-process `auth.api.requestPasswordReset` mints the
 * token row and fires the sendResetPassword email hook (lib/forgot-password's
 * issueResetEmail) — no new token/email code path. The emailed link is fully
 * self-contained: expiry, single-use consume, ban + credential guards all live
 * in the public reset routes the user clicks into, so an admin can never force a
 * password on anyone; they only start the flow.
 *
 * Guard order (mirrors app/api/auth/password-reset/route.ts): super-admin →
 * rate limit → target exists → banned (401) → has local credential (403; OIDC-only
 * accounts have no portal password to reset — lib/forgot-password.hasCredentialAccount)
 * → BetterAuth. The email is the user's own, taken from the target row (never
 * request input). Audit carries the acting admin + masked target email only.
 */
import { NextRequest, NextResponse } from 'next/server';

import { auth, enforceBanStatus } from '@/lib/auth';
import { APIError } from 'better-auth/api';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';
import { recordAuditLog } from '@/lib/audit-log';
import { AUDIT_ACTION, hasCredentialAccount, maskEmail } from '@/lib/forgot-password';
import tenantDb from '@/lib/tenant-db';
import { withPlatformContext } from '@/lib/platform-db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireSuperAdmin(request.headers);
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  try {
    const adminUserId = authResult.session!.user.id;
    const id = (await params).id;

    if (!checkAdminRateLimit(adminUserId)) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }

    // RLS: verified platform context (User has no RLS; ctx kept for audit consistency).
    const user = await withPlatformContext(adminUserId, () =>
      tenantDb.user.findUnique({ where: { id } }),
    );
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const email = user.email!.toLowerCase().trim();

    // Ban gate BEFORE BetterAuth (design T4/Q1, same position as the public
    // request route): a banned user gets no inbox re-arm; expiry lifting stays
    // in enforceBanStatus' single implementation.
    await enforceBanStatus(email);

    // OIDC-only guard — the admin version of design T5. An account whose only
    // credential is Google has no portal password to reset; the UI hides the
    // action, this closes the forged-call path (hasCredentialAccount reads the
    // TARGET's accounts inside the target's own platform context).
    const canReset = await hasCredentialAccount(id);
    if (!canReset) {
      logger.info(
        { adminUserId, targetUserId: id },
        'Admin password-reset requested for an OIDC-only account (refused)',
      );
      return NextResponse.json(
        { error: 'This account signs in with Google — it has no portal password to reset.' },
        { status: 403 },
      );
    }

    // In-process call — host header carries this request's origin so the
    // sendResetPassword hook builds the emailed link where the admin sent from.
    await auth.api.requestPasswordReset({
      body: { email },
      headers: new Headers({ host: new URL(request.url).host }),
    });

    await recordAuditLog({
      userId: adminUserId,
      action: AUDIT_ACTION.PASSWORD_RESET_REQUESTED_BY_ADMIN,
      resourceType: 'User',
      resourceId: id,
      ipAddress: request.headers.get('x-forwarded-for'),
      success: true,
      metadata: { maskedEmail: maskEmail(email) },
    });

    logger.info(
      { adminUserId, targetUserId: id, maskedEmail: maskEmail(email) },
      'Admin issued a password-reset link',
    );

    return NextResponse.json({ status: true });
  } catch (error) {
    // Surface BetterAuth's own copy for APIErrors (ban → 'Access denied…');
    // everything else is internal. DB outage maps to 503 per sibling routes.
    if (error instanceof APIError && error.statusCode === 401) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    const isDbError = error instanceof Error && /Can't reach database server/.test(error.message);
    logger.error(
      { err: error, route: '/api/dashboard/admin/users/[id]/reset-password' },
      'Admin password reset failed',
    );
    return NextResponse.json(
      { error: isDbError ? 'Database unavailable' : 'Failed to send password-reset email' },
      { status: isDbError ? 503 : 500 },
    );
  }
}
