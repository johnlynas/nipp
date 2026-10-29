/**
 * POST /api/auth/password
 *
 * Change the signed-in user's OWN email/password credential. The new password
 * is hashed (better-auth scrypt) and written to both places the credential
 * lives — User.passwordHash (catalog display/admin tooling) and the
 * providerId='credential' Account row that BetterAuth actually verifies at
 * sign-in. Mirrors what UserService.create does in reverse.
 *
 * Google-OIDC-only accounts are rejected server-side too (403) so a hand-built
 * request cannot bypass the chip's disabled menu item. Uses the same IP rate
 * limiter as the sign-in door — password changes are rare and legitimate, so
 * 5/min per IP leaves ample headroom while throttling automation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
// User/Account are global (RLS-exempt) but app routes go through tenantDb by
// the isolation rule; wrapping in withPlatformContext keeps behaviour identical
// on owner and non-owner DB roles (same pattern as /api/auth/me).
import tenantDb from '@/lib/tenant-db';
import { withPlatformContext } from '@/lib/platform-db';
import { hashPassword } from 'better-auth/crypto';
import { recordAuditLog } from '@/lib/audit-log';
import { logger } from '@/lib/logger';
import { checkAuthRateLimit, getClientIp } from '@/lib/rate-limiter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: NextRequest) {
  try {
    logger.info({ route: '/api/auth/password', method: 'POST' }, 'Request received');

    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    // Sign-in-door idiom: tight per-IP limit for auth-adjacent writes.
    if (!checkAuthRateLimit(getClientIp(request))) {
      logger.warn({ userId }, 'Password change rate limited');
      return NextResponse.json({ error: 'Too many requests — try again in a minute.' }, { status: 429 });
    }

    let body: { password?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const password = typeof body.password === 'string' ? body.password : '';
    if (!password.trim()) {
      return NextResponse.json({ error: 'A new password is required.' }, { status: 400 });
    }
    // scrypt input ceiling — longer values break verification, so reject them.
    if (password.length > 72) {
      return NextResponse.json({ error: 'Password must be at most 72 characters.' }, { status: 400 });
    }

    // Server-side mirror of the chip rule: only Google-OIDC-only accounts are
    // refused (they have no local password of their own). Users with BOTH doors
    // (credential + google) sign in locally too, so a lost-password recovery
    // must keep working for them. All credential writes happen inside one
    // platform context — the verified session user's id is the only userId in
    // play; nothing from the request body can steer it elsewhere.
    const providers = await withPlatformContext(userId, () =>
      tenantDb.account.findMany({ where: { userId }, select: { providerId: true } }),
    );
    if (!providers.some((p) => p.providerId === 'credential')) {
      logger.warn({ userId, providers: providers.map((p) => p.providerId) }, 'Rejected password change for a Google-OIDC-only account');
      return NextResponse.json(
        { error: 'Password changes are only available for email & password accounts.' },
        { status: 403 },
      );
    }

    const passwordHash = await hashPassword(password);

    // Keep the legacy User.passwordHash column and the credential Account row
    // in lockstep — BetterAuth signs in against the Account row.
    await withPlatformContext(userId, async () => {
      await tenantDb.user.update({ where: { id: userId }, data: { passwordHash } });

      const existingAccount = await tenantDb.account.findFirst({
        where: { userId, providerId: 'credential' },
        select: { id: true },
      });
      if (existingAccount) {
        await tenantDb.account.update({ where: { id: existingAccount.id }, data: { password: passwordHash } });
      } else {
        // Same row shape UserService.create writes for new local users.
        await tenantDb.account.create({
          data: { id: userId, accountId: userId, providerId: 'credential', password: passwordHash, userId },
        });
      }
    });

    logger.info({ userId }, '[Password API] Password updated');

    await recordAuditLog({
      userId,
      userName: (session.user as { name?: string }).name ?? undefined,
      action: 'user.password-changed',
      resourceType: 'User',
      resourceId: userId,
      success: true,
    }).catch((err) => logger.error({ err }, 'Failed to record audit log for password change'));

    return NextResponse.json(
      { success: true, message: 'Password updated' },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } },
    );
  } catch (error) {
    const isDbError = error instanceof Error && error.message.includes("Can't reach database server");
    logger.error({ err: error, route: '/api/auth/password', method: 'POST' }, isDbError ? '[Password API] Database unavailable' : '[Password API] Unexpected error');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal server error' }, { status: isDbError ? 503 : 500 });
  }
}
