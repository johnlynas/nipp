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

import os from 'os';
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
  | { ok: true; token: string; url: string; emailSent: boolean }
  | { ok: false; error: string };

export interface IssueInviteOptions {
  /**
   * Injectable send seam — defaults to the real sendEmail. Call sites that
   * need to know whether delivery succeeded (the create/resend routes, which
   * report magicLinkSent) pass their own wrapper; tests inject a recorder.
   */
  sendFn?: (to: string, subject: string, message: string, headerTitle?: string) => Promise<{ success: boolean; error?: unknown }>;

  /**
   * Origin the link is built on (PUBLIC ACCESS fix). Without it the server
   * falls back to FRONTEND_URL — which pins links to localhost:3000 in a LAN /
   * cloud deployment and produces dead URLs. Call sites must pass `new URL(
   * request.url).origin` from their OWN incoming request so the button points
   * at wherever the user/admin is actually reaching (LAN IP, tunnel host,
   * public domain) — same host-independent principle as lib/csrf.ts's
   * isSameOriginRequest.
   */
  portalOrigin?: string | null;
}

/**
 * Issue a magic link for an invited user: insert a Verification row and send
 * the CTA email. Token is unique per call; old tokens remain consumable until
 * they expire (re-issue is idempotent-safe by design).
 *
 * SMTP failures are logged, NOT thrown — the token stays in the database so
 * the link (if it arrives late) and admin resend both work.
 */
export async function issueInviteLink(
  user: InviteUser,
  options: IssueInviteOptions = {},
): Promise<IssueInviteResult> {
  const sendFn = options.sendFn ?? ((to: string, subject: string, message: string, headerTitle?: string) =>
    sendEmail(to, subject, message, headerTitle));

  const token = generateRandomString(32);
  // PUBLIC ACCESS fix: derive the link's origin from the originating request
  // (options.portalOrigin) so it works on LAN IP / tunnel host / public domain;
  // FRONTEND_URL only as the off-request-context fallback. Malformed origins are
  // rejected (fail closed to FRONTEND_URL — never emit an unparseable URL).
  const base = resolveLinkBase(options.portalOrigin);
  const url = `${base}${VERIFY_PATH}?token=${token}`;

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

  let emailSent = false;
  try {
    const result = await sendFn(
      user.email,
      'NIPP account activation',
      htmlMessage,
      'NIPP account activation'
    );
    if (!result.success) {
      logger.error({ err: result.error, userId: user.id }, '[OidcInvite] Invite email failed (token remains valid for resend window)');
    } else {
      emailSent = true;
      logger.info({ userId: user.id, tokenExpiry: TOKEN_TTL_MS / 60000 + 'm' }, '[OidcInvite] Invitation link issued');
    }
  } catch (err) {
    logger.error({ err, userId: user.id }, '[OidcInvite] Invite email raised (token remains valid)');
  }

  return { ok: true, token, url, emailSent };
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

/**
 * Mark a user as OIDC-verified after their activation token is consumed. Runs
 * in this module (not the route) because it touches the global prisma client —
 * `@/lib/db` is lint-restricted out of app routes for RLS scoping, and User has
 * no RLS, so operating here matches issueInviteLink/consumeInviteToken. Idempotent:
 * a concurrent race that already set the flag issues no second update. Returns
 * the user id (null if the account was deleted after invite).
 */
export async function markOidcVerified(email: string): Promise<{ userId: string | null }> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return { userId: null };

  if (!user.oidcVerified) {
    await prisma.user.update({
      where: { id: user.id },
      data: { oidcVerified: true, emailVerified: true },
    });
  }
  return { userId: user.id };
}

/**
 * Normalize a candidate portal origin (PUBLIC ACCESS fix). Accepts a full
 * URL or a bare origin, strips any trailing slash. Returns null on malformed
 * input so the caller can fall back deterministically to FRONTEND_URL.
 */
export function normalizePortalOrigin(origin: string | null | undefined): string | null {
  if (!origin) return null;
  try {
    const u = new URL(origin, 'http://local.invalid'); // relative inputs (host:port only) resolve here
    if (u.origin === 'http://local.invalid') return null; // bare path — not an origin
    return u.origin.replace(/\/$/, '');
  } catch {
    return null;
  }
}

/**
  * The machine's LAN IPv4 address (first non-internal IPv4 from
  * os.networkInterfaces), or null when the server exposes no usable one
  * (e.g. Docker-only networking). Server-side only — `os` needs system APIs.
 */
export function getMachineIPv4(): string | null {
  const interfaces = os.networkInterfaces();
  for (const networkInterface of Object.values(interfaces)) {
    if (!networkInterface) continue;
    for (const net of networkInterface) {
      if (net.family === 'IPv4' && !net.internal)  {
        return net.address;
      }
    }
  }
  return null;
}


/** Hosts behind which emails are unreachable from other machines. */
function isLoopbackOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
}

/**
 * Final link origin for the emailed magic link:
 *  - explicit non-loopback portalOrigin → it (LAN IP / tunnel host / domain);
 *  - loopback portalOrigin (admin inviting from their own browser) and a
 *    machine LAN IPv4 → http://<machine-ip>:<request-port> — the same port the
 *    port the request came in on, so the link points where the server is actually
 *    reachable, not 127.0.0.1 (unreachable to the invited user);
 *  - no origin / loopback origin with no LAN IPv4 → FRONTEND_URL (fail closed).
 */
function resolveLinkBase(portalOrigin: string | null | undefined): string {
  const origin = normalizePortalOrigin(portalOrigin);
  if (origin) {
    if (!isLoopbackOrigin(origin)) return origin;
    const ip = getMachineIPv4();
    if (ip) {
      const port = new URL(origin).port || '80';
      return `${new URL(origin).protocol}//${ip}:${port}`;
    }
  }
  return env.FRONTEND_URL.replace(/\/$/, '');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
