/**
 * Invitation magic-link plumbing (Google OIDC pre-registration, design §4.3).
 *
 * A user invited by an admin can activate Google sign-in ONLY after clicking a
 * one-time emailed link — inbox ownership proved server-side. This module owns
 * the token lifecycle end-to-end and nothing else: issue (Verification row +
 * email) and atomic single-use consume.
 *
 * Deliberately NOT part of this flow: session minting. The verify route calls
 * `consumeInviteToken` and redirects to /login; sign-in itself happens through
 * the normal Google OIDC path, which then passes the provisioning gate in
 * lib/auth.ts (enforceOidcProvisioning). Local email/password sign-in never
 * touches this module.
 */

import { generateRandomString } from 'better-auth/crypto';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { sendEmail } from '@/lib/notifications/email';
import { logger } from '@/lib/logger';

/** Token lifetime — design §4.3 default (5 minutes). */
const TOKEN_TTL_MS = 5 * 60 * 1000;

/** Verify route path, relative to the portal origin. */
const VERIFY_PATH = '/auth/magic-link/verify';

export interface InviteUser {
  id: string;
  name: string;
  email: string;
}

export type IssueInviteResult =
  | { ok: true; token: string; url: string }
  | { ok: false; error: string };

/**
 * Issue a magic link for an invited user: insert a Verification row and send
 * the CTA email. Token is unique per call; old tokens remain consumable until
 * they expire (re-issue is idempotent-safe by design).
 *
 * SMTP failures are logged, NOT thrown — the token stays in the database so
 * the link (if it arrives late) and admin resend both work.
 */
export async function issueInviteLink(user: InviteUser): Promise<IssueInviteResult> {
  const token = generateRandomString(32);
  const url = `${env.FRONTEND_URL}${VERIFY_PATH}?token=${token}`;

  try {
    await prisma.verification.create({
      data: {
        identifier: token,
        value: JSON.stringify({ email: user.email.toLowerCase(), kind: 'oidc-invite' }),
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      },
    });
  } catch (err) {
    logger.error({ err, userId: user.id }, '[OidcInvite] Failed to persist verification row');
    return { ok: false, error: 'Could not store the invitation token. Try again.' };
  }

  let name: string;
  if (user.name === 'User' || !user.name.trim()) {
    // BetterAuth's default display name is the email local part — use the raw
    // address so the greeting stays informative.
    name = user.email.split('@')[0];
  } else {
    name = user.name.trim();
  }

  const htmlMessage = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>You've been invited to activate your Property NI portal account.
    Click the button below to verify this email address — it takes a few seconds.</p>
    <p style="margin: 24px 0;">
      <a href="${url}"
         style="display: inline-block; background-color: #1B2A4A; color: #ffffff;
                text-decoration: none; padding: 12px 28px; border-radius: 6px;
                font-size: 15px;">Activate my account</a>
    </p>
    <p>If the button doesn't work, copy this link into your browser:</p>
    <p style="word-break: break-all; color: #6c757d; font-size: 13px;">${url}</p>
    <p>This link expires in ${Math.round(TOKEN_TTL_MS / 60000)} minutes. Afterwards,
    sign in at the portal with your Google account as usual.</p>`;

  try {
    const result = await sendEmail(
      user.email,
      'Activate your Property NI account',
      htmlMessage,
      'Property NI — Account Activation'
    );
    if (!result.success) {
      logger.error({ err: result.error, userId: user.id }, '[OidcInvite] Invite email failed (token remains valid for resend window)');
    } else {
      logger.info({ userId: user.id, tokenExpiry: TOKEN_TTL_MS / 60000 + 'm' }, '[OidcInvite] Invitation link issued');
    }
  } catch (err) {
    logger.error({ err, userId: user.id }, '[OidcInvite] Invite email raised (token remains valid)');
  }

  return { ok: true, token, url };
}

export type ConsumeInviteResult =
  | { ok: true; email: string }
  | { ok: false; reason: 'invalid' | 'expired' };

/**
 * Atomically consume an invitation token. Exactly one call can succeed per
 * token: the claim is `deleteMany` keyed on identifier AND future expiry, so a
 * replay/expired/unknown token finds nothing to delete. Unknown → invalid,
 * past-expiresAt (still present) → expired — reported distinctly for UX but
 * both are failures by construction.
 */
export async function consumeInviteToken(token: string): Promise<ConsumeInviteResult> {
  const row = await prisma.verification.findFirst({ where: { identifier: token } });
  if (!row) return { ok: false, reason: 'invalid' };

  let parsedEmail: string | undefined;
  try {
    parsedEmail = (JSON.parse(row.value) as { email?: string }).email?.toLowerCase();
  } catch {
    parsedEmail = undefined;
  }
  if (!parsedEmail) return { ok: false, reason: 'invalid' };

  const now = new Date();
  if (row.expiresAt <= now) return { ok: false, reason: 'expired' };

  // Atomic claim — a concurrent duplicate request will delete zero rows.
  const deleted = await prisma.verification.deleteMany({
    where: { identifier: token, expiresAt: { gt: now } },
  });
  if (deleted.count === 0) return { ok: false, reason: 'expired' };

  return { ok: true, email: parsedEmail };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
