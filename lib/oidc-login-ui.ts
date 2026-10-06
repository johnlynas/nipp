/**
 * Pure helpers for the /login page's Google-OIDC pre-registration banner
 * states (design §4.3 + plan Phase 3, Task 7). Kept server-free so the unit
 * suite can pin the classification rules without rendering the page.
 *
 * The two provisioning-gate rejections from lib/auth.ts (enforceOidcProvisioning)
 * reach the login page through the OAuth callback round-trip: BetterAuth lands
 * the browser on errorCallbackURL with `?error=…&error_description=<message>`.
 * classifyGateMessage decides which banner that message belongs to — the ban
 * detector MUST NOT swallow the two new gate messages into a "banned" state.
 */

/** Banner kinds for sign-in rejection messages. */
export type GateKind = 'banned' | 'needs-inbox-check' | 'not-provisioned';

/**
 * Classify a sign-in rejection message. Order matters: the two gate messages
 * both start with "Access denied.", so they are matched BEFORE the banned
 * detector. A genuine ban message (`Access denied. <reason>`) never contains
 * the gate substrings, so this is safe for the email path (which only ever
 * returns ban rejections) as well.
 */
export function classifyGateMessage(message: string): GateKind | null {
  const m = message.toLowerCase();
  if (m.includes('check your inbox')) return 'needs-inbox-check';
  if (m.includes('provisioned')) return 'not-provisioned';
  if (m.includes('banned') || m.includes('access denied')) return 'banned';
  return null;
}

export interface OidcParamBanner {
  tone: 'success' | 'info';
  text: string;
}

/** Copy for the success state — magic link consumed, awaiting Google sign-in. */
export const OIDC_LINK_VERIFIED_TEXT =
  'Email verified — click Sign in with Google to finish activating your account.';

/** Copy for expired / invalid / unknown ?oidc=… values. */
export const OIDC_LINK_FAILED_TEXT =
  'That invite link has expired or is invalid — ask your administrator to send a new one.';

/**
 * Map the one-shot `?oidc=` query param (set by the magic-link verify route)
 * to a banner. Exactly two tones: success for `link-verified`, info for every
 * other value (`link-expired` and any unknown value). Null when the param is
 * absent so callers can leave the URL untouched.
 */
export function oidcParamBanner(oidc: string | null): OidcParamBanner | null {
  if (!oidc) return null;
  if (oidc === 'link-verified') return { tone: 'success', text: OIDC_LINK_VERIFIED_TEXT };
  return { tone: 'info', text: OIDC_LINK_FAILED_TEXT };
}

/**
 * Same-origin guard for the OAuth round-trip callback target. The raw value
 * ends up in a URL we navigate to, so only relative paths from the portal are
 * accepted; everything else falls back to `'/`'. Rejects empty/absolute forms,
 * protocol-relative (`//evil.com`) and unparseable targets alike.
 */
export function resolveSameOriginTarget(raw: string | null, origin: string): string {
  if (!raw || !raw.startsWith('/')) return '/';
  try {
    const candidate = new URL(raw, origin);
    if (candidate.origin === new URL(origin).origin) return raw;
  } catch {
    // Unparseable target — fall back to home.
  }
  return '/';
}
