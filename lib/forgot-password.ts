/**
 * Forgot-password (local users) — token issuance, email, guards, audit.
 *
 * Phase 1 per the implementation plan
 * (.hermes/plans/2026-10-29_155244-forgot-password-plan.md): this module owns
 * the request-side helpers of the flow —
 *   - `maskEmail`                   (PII redaction for audit metadata, design §9 T8 / §13 Q5)
 *   - `PASSWORD_RESET_TOKEN_TTL_SECS` (token lifetime in seconds, design §11)
 *   - `issueResetEmail`             (host-independent reset link + branded email;
 *                                    does NOT create the Verification row —
 *                                    BetterAuth's requestPasswordReset handler owns
 *                                    token generation and row creation single-sourced)
 *   - `hasCredentialAccount`        (server-side mirror of /api/auth/password's guard, design T5)
 *
 * Token ownership: this module never mints reset tokens. The Phase 2 wiring
 * passes the token BetterAuth generated into issueResetEmail; the emailed URL is
 * built here as <origin>/auth/reset-password?token=<token> because BetterAuth's
 * stock url points at `<baseUrl>/reset-password/<token>` which has no page in
 * this repo (would 404).
 */

import { prisma } from '@/lib/db';
import { withPlatformContext } from '@/lib/platform-db';
import { resolveLinkBase as magicLinkResolveOrigin } from '@/lib/oidc-magic-link';
import { sendEmail, escapeHtml } from '@/lib/notifications/email';
import { logger } from '@/lib/logger';

/** Reset-token lifetime (seconds) — documented in SECURITY.md §9. */
export const PASSWORD_RESET_TOKEN_TTL_SECS = Number(
  process.env.PASSWORD_RESET_TOKEN_TTL_SECS ?? 3600,
);

// ─── Link origin ──────────────────────────────────────────────────────────────

/**
 * Host-independent base for the reset link. Delegates to oidc-magic-link's
 * resolveLinkBase — identical semantics (explicit non-loopback origin wins,
 * loopback maps to machine LAN IPv4 on the request port, FRONTEND_URL as the
 * fail-closed fallback). Exposed separately under this name so Phase 3 callers
 * read "reset" in their imports rather than "magic-link".
 */
export function resolveResetLinkOrigin(portalOrigin: string | null | undefined): string {
  return magicLinkResolveOrigin(portalOrigin);
}

// ─── PII masking ──────────────────────────────────────────────────────────────

/**
 * PII masking for audit/log writes (SECURITY.md §8 redaction class, design §13 Q5).
 * Masks everything after the first character of the local part, keeps the domain:
 *   john@example.com → j***@example.com
 *   a@x.co            → a***@x.co
 * Complements — does not duplicate — the pino-redaction pipeline in lib/logger.ts.
 */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}

// ─── Reset email issuance ─────────────────────────────────────────────────────

/** Result contract — the token row is unaffected by SMTP delivery outcome. */
export interface IssueResetEmailResult {
  emailSent: boolean;
}

/** Injectable send seam — mirrors issueInviteLink's contract (design §6). */
type SendFn = (to: string, subject: string, message: string) => Promise<{ success: boolean; error?: unknown }>;

export interface IssueResetEmailOptions {
  /** Origin the link is built on (PUBLIC ACCESS fix, same as magic-link). */
  portalOrigin?: string | null;
  sendFn?: SendFn;
}

/**
 * Build a branded Property NI reset email and send it. This helper renders AND
 * sends only — BetterAuth's requestPasswordReset handler owns the token + row,
 * so there is no Verification write here (token ownership single-sourced).
 *
 * SMTP failures are logged, NOT thrown: { emailSent: false } lets the Phase 3
 * route audit/report without disturbing the token lifecycle. The default sendFn
 * wraps the real lib/notifications/email sender (4-arg shape; headerTitle is
 * pinned to the subject per the invitation precedent).
 */
export async function issueResetEmail(
  user: { id: string; email: string; name?: string },
  token: string,
  options: IssueResetEmailOptions = {},
): Promise<IssueResetEmailResult> {
  const email = user.email.toLowerCase().trim();
  const sendFn: SendFn =
    options.sendFn ??
    ((to, subject, message) => sendEmail(to, subject, message, 'Property NI — Reset your password'));

  // BetterAuth's default display name is the email local part ("User") — use the
  // raw local address so the greeting stays informative, matching issueInviteLink.
  const name = (user.name && user.name.trim() !== 'User')
    ? user.name.trim()
    : email.split('@')[0];

  const origin = resolveResetLinkOrigin(options.portalOrigin);
  const url = `${origin}/auth/reset-password?token=${token}`;

  const htmlMessage = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>We received a request to reset the password for your Property NI portal account.
       Click the button below — it takes a minute.</p>
    <p style="margin: 24px 0;">
      <a href="${url}"
         style="display: inline-block; background-color: #1B2A4A; color: #ffffff;
                text-decoration: none; padding: 12px 28px; border-radius: 6px;
                font-size: 15px;">Reset my password</a>
    </p>
    <p>If the button doesn't work, copy this link into your browser:</p>
    <p style="word-break: break-all; color: #6c757d; font-size: 13px;">${url}</p>
    <p>This link expires in ${Math.round(PASSWORD_RESET_TOKEN_TTL_SECS / 60)} minutes. If you didn't request this, ignore this email.</p>`;

  try {
    const result = await sendFn(email, 'Property NI — Reset your password', htmlMessage);
    if (!result.success) {
      logger.error({ err: result.error, userId: user.id }, '[ForgotPassword] Reset email failed (token row remains valid for retry)');
      return { emailSent: false };
    }
    logger.info({ userId: user.id, maskedEmail: maskEmail(email) }, '[ForgotPassword] Reset link issued');
    return { emailSent: true };
  } catch (err) {
    logger.error({ err, userId: user.id }, '[ForgotPassword] Reset email raised (token row remains valid)');
    return { emailSent: false };
  }
}

// ─── Credential guard ─────────────────────────────────────────────────────────

/**
 * Server-side credential-account guard (design T5). Mirrors the /api/auth/password
 * route's check so a hand-built request cannot force-reset an OIDC-only account.
 * Returns true iff at least one Account row for userId has providerId='credential'.
 * Runs in withPlatformContext(userId) — same idiom as that route — so the read is
 * scoped to the user being checked, never request input (fail-closed on empty id).
 */
export async function hasCredentialAccount(userId: string): Promise<boolean> {
  const providers = await withPlatformContext(userId, () =>
    prisma.account.findMany({ where: { userId }, select: { providerId: true } }),
  );
  return providers.some((p) => p.providerId === 'credential');
}

// ─── Audit action constants (Phase 3 imports these — no inline strings in routes) ──

export const AUDIT_ACTION = {
  PASSWORD_RESET_REQUESTED: 'user.password-reset-requested',
  PASSWORD_RESET_LINK_OPENED: 'user.password-reset-link-opened',
  PASSWORD_RESET_SUCCESS: 'user.password-reset-success',
} as const;

export type AuditActionName = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];
