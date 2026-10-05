import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';
// RLS Phase 3: invitation re-issue is a platform op (User has no RLS — verified context kept).
import tenantDb from '@/lib/tenant-db';
import { withPlatformContext } from '@/lib/platform-db';
import { issueInviteLink } from '@/lib/oidc-magic-link';
import { recordAuditLog } from '@/lib/audit-log';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * POST /api/dashboard/admin/users/[id]/invite
 * Resend the activation magic link for an invited (pre-registered) user.
 *
 * Idempotent by design: a verified account gets `{ alreadyVerified: true }`
 * without touching email; a pending account gets a fresh 5-minute token (old
 * tokens stay consumable until expiry — see lib/oidc-magic-link).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const id = (await params).id;

  try {
    if (!checkAdminRateLimit(auth.session!.user.id)) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }

    // RLS: verified platform context (User table has no RLS; ctx kept for audit consistency).
    const user = await withPlatformContext(auth.session!.user.id, () =>
      tenantDb.user.findUnique({ where: { id } }),
    );
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Idempotency: verification already complete — nothing to resend.
    if (user.oidcVerified) {
      logger.info(
        { adminUserId: auth.session!.user.id, targetUserId: id },
        'Invite resend requested for an already-verified user (no-op)',
      );
      return NextResponse.json({ alreadyVerified: true });
    }

    const issueResult = await issueInviteLink(user);
    if (!issueResult.ok) {
      logger.error(
        { adminUserId: auth.session!.user.id, targetUserId: id, err: issueResult.error },
        'Invite resend failed to persist a token',
      );
      return NextResponse.json({ error: issueResult.error }, { status: 500 });
    }

    await recordAuditLog({
      userId: auth.session!.user.id,
      action: 'user.invite-resent',
      resourceType: 'User',
      resourceId: id,
      success: issueResult.emailSent,
    }).catch((err) => logger.error({ err }, 'Failed to record audit log for invite resend'));

    logger.info(
      { adminUserId: auth.session!.user.id, targetUserId: id, emailSent: issueResult.emailSent },
      'Invitation magic link re-issued',
    );

    return NextResponse.json({ resent: issueResult.emailSent });
  } catch (error) {
    const isDbError = error instanceof Error && error.message.includes("Can't reach database server");
    logger.error({ err: error, adminUserId: auth.session!.user.id }, 'Failed to resend invitation');
    return NextResponse.json(
      { error: isDbError ? 'Database unavailable' : 'Failed to resend invitation' },
      { status: isDbError ? 503 : 500 },
    );
  }
}
