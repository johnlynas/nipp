---
target: app/login/page.tsx
total_score: 31
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-09-26T14-10-25Z
slug: app-login-page-tsx
---
# Critique — app/login/page.tsx (2026-09-26 14:45)

⚠️ DEGRADED: single-context (no sub-agent tool exposed). Assessments A/B run sequentially inline; detector returned [] (clean, exit 0).

## Heuristic scores (/40, all 10 applicable — Operate mode)
1 Visibility of status: 3 · 2 Match real world: 4 · 3 Control: 3 · 4 Consistency: 3 · 5 Error prevention: 3
6 Recognition: 3 · 7 Flexibility: 3 · 8 Aesthetic/minimalist: 4 · 9 Recovery: 4 · 10 Help: 2
Total: 31/40 (Good)

## Design specificity verdict
Authored, not category-interchangeable. Skyline field is bespoke to the product subject and drawn entirely in project tokens (navy-950→850, slate whites, amber strictly functional). One gap: below lg the brand world vanishes entirely — mobile is a bare wordmark on canvas-subtle.

## Strengths
1. Straight edge + 28px rounded radius seam — crisp navy-to-canvas step verified in pixels; corner carries all softening.
2. Left panel hierarchy: wordmark top, statement anchored over quiet water; glow removal resolved the bright-mid-page clash.
3. Form restraint: single amber CTA with ink text (~7.5:1), consistent rounded-lg controls, honest note behavior on unwired SSO buttons.

## Priority issues
- [P1] "Signin with email" casing vs "Sign in with Google/Apple" → /impeccable clarify
- [P1] No password-recovery affordance; admin contact is buried prose → make actionable (mailto/link) → /impeccable harden
- [P2] Mobile loses the brand world below lg; consider ~96px dark skyline strip header → /impeccable adapt
- [P2] Statement copy: "Contractors" mid-sentence capital, filler leading "A" → /impeccable clarify (user approval required)
- [P3] No password show/hide toggle → /impeccable harden

## Minor observations
- Right panel content sits ~20px optically high (92 top vs 61 bottom clearance at 862h viewport) — negligible.
- Error banner auto-dismisses at 10s; consider skipping when isBanned=true (longer message).

## Personas
Jordan: button casing inconsistency + no visible forgot-password path while a form demands a secret. Alex: unblocked on all fronts. Sam: no flags — labeled inputs, accent focus ring, aria-live, white/70 statement passes AA over navy-950.
