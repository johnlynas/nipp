/**
 * Forgot-password (local users) — token issuance, email, guards, audit.
 *
 * Phase 1 scaffold per the implementation plan
 * (.hermes/plans/2026-10-29_155244-forgot-password-plan.md): the pieces landed
 * here are `maskEmail` (PII redaction for audit metadata, design §9 T8) and
 * `PASSWORD_RESET_TOKEN_TTL_SECS` (token lifetime in seconds, design §11).
 *
 * Later tasks (1.2–1.4, Phase 2–3) extend this module with `issueResetEmail`,
 * `hasCredentialAccount`, and the audit action-name constants.
 */

/** Reset-token lifetime (seconds) — documented in SECURITY.md §9. */
export const PASSWORD_RESET_TOKEN_TTL_SECS = Number(
  process.env.PASSWORD_RESET_TOKEN_TTL_SECS ?? 3600,
);

/**
 * PII masking for audit/log writes (SECURITY.md §8 redaction class, design §13 Q5).
 * Masks everything after the first character of the local part, keeps the domain:
 *   john@example.com → j***@example.com
 *   a@x.co            → a***@x.co
 */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}