# NIPP Portal MCP Server — Proposal

**Status:** Draft for review
**Date:** 2026-11-06
**Author:** (pending)
**Audience:** Engineering team, product stakeholders

---

## 1. Background & motivation

NIPP is a multi-tenant property management portal built on Next.js 16 with a REST API of **109 endpoints across ~186 operations** (work orders, calendars, quotes, invoices, contractors, teams, users, roles, permissions, jobs, audit logs). Today, interacting with that data means opening the browser and clicking through the UI.

An **MCP (Model Context Protocol) server** would let AI assistants — Claude, Cursor, Hermes, or any MCP-compatible client — read from and act on the portal directly: *"list open work orders for Unit 4B"*, *"create a quote for the roof repair"*, *"what's on the calendar this week?"*.

The portal already generates an OpenAPI 3.0 spec (`docs/openapi/generated/openapi.json`) with typed request/response schemas, which makes building this server substantially cheaper than starting from scratch.

**Why now:** MCP is the emerging standard for connecting AI tools to internal systems, and our API surface is already machine-described. The marginal cost of an agent-accessible portal is low; the operational upside (faster admin workflows, natural-language reporting) is high.

## 2. What we're proposing

A standalone TypeScript package (`mcp-server/` in the nipp-0111 repo) that:

1. **Generates MCP tools from the OpenAPI spec** — a codegen script turns each API operation into a named, described, schema-validated tool. No hand-written tool definitions; when the API changes, re-run one command.
2. **Proxies requests to the portal with session passthrough** — the operator's existing BetterAuth session cookie is forwarded on every call. The MCP server introduces **no new authentication mechanism**: the portal's existing auth gates, ban checks, row-level security, and CSRF protection all apply exactly as they do for a browser request.
3. **Gates mutations with explicit confirmation** — any non-read tool requires the AI to state its intent and set `confirm: true`. Destructive/admin groups are off by default behind environment flags.
4. **Audit-logs every call** — JSON lines of who called what, with what arguments, and the outcome.

### What it is NOT

- Not a new API gateway or auth system — it adds zero surface to the portal itself (Phase 1 touches no existing files).
- Not a general-purpose "AI can do anything" tool — a hard exclusion list keeps sign-in endpoints, payload-key security endpoints, and CSP reporting out of reach.
- Not a shared multi-user service in Phase 1 — it runs locally per operator (stdio transport), which is also the safest deployment shape.

## 3. Scope of work

### API surface inventory (verified from `openapi.json`, 2026-11-06)

| Area | Operations | MCP exposure |
|---|---|---|
| Organizations (calendars, events, work orders, quotes, teams) | 31 | **Phase 1** — on by default |
| Admin read-only (users, roles, logs, metrics, lists) | ~40 | **Phase 1** — on by default |
| Mutations across org + admin (create/update/delete/transition) | ~95 | **Phase 2** — behind `NIPP_MCP_ENABLE_MUTATIONS=1` |
| Admin writes (user/role/permission management, job triggers) | included above | **Phase 2** — additionally behind `NIPP_MCP_ENABLE_ADMIN=1` |
| Auth endpoints (`/api/auth/*`) | 9 | **Never exposed** (hardcoded exclusion) |
| Security payload-key endpoints | 2 | **Never exposed** (hardcoded exclusion) |
| Infra (health, cache metrics, CSP report) | 4 | Health optional; rest excluded |

### Work breakdown

| # | Workstream | Effort |
|---|---|---|
| 1 | Tool selection & allowlist design (phased groups, exclusions, naming convention) | ~2h |
| 2 | OpenAPI → MCP tool codegen script (typed output, collision-safe names, tolerates the 22 ops without documented response schemas) | ~4h |
| 3 | Portal HTTP client (cookie passthrough, timeouts, structured error normalization; CSRF verification for mutations) | ~2h |
| 4 | MCP server wiring (official SDK, stdio transport, graceful shutdown) | ~2h |
| 5 | Confirmation gates for all mutations + admin opt-in flags | ~2h |
| 6 | Audit trail (pino JSON file logger, never on the MCP channel) | ~1h |
| 7 | Testing: unit (codegen, client, config, confirm), integration smoke vs docker test stack, MCP Inspector manual pass | ~4h |
| 8 | Docs & ops: README, `.env.example`, troubleshooting (session expiry), tool catalog | ~2h |
| | **Total** | **~19h** |

### Delivery phases

- **Phase 1 — Read-only MVP (~7h).** All safe GET operations exposed. Ship immediately; zero write risk. This alone answers "what's the state of my portfolio?" style questions.
- **Phase 2 — Mutations with guardrails (~8h).** Write tools behind env flags, confirmation gates live, audit trail verified, CSRF behavior confirmed against real POSTs.
- **Phase 3 — Optional remote deployment (~4h).** Only if a shared server is wanted: streamable HTTP transport, MCP-channel auth, per-org scoping (requires portal-side API-token support — a separate project).

## 4. Technology choice

**Recommendation: TypeScript on Node 22.**

| Language | Performance | Security | Fit for NIPP |
|---|---|---|---|
| **TypeScript / Node 22** | Excellent for this workload (see below) | Strong — Zod validation at the boundary, official first-party MCP SDK | **Best fit** — same language, toolchain, and schema library as the portal |
| Go | Best raw performance; single static binary | Small attack surface | Only worth it for a high-concurrency shared server; no official SDK parity |
| Rust (rmcp) | Best performance & footprint; memory safety | Strongest theoretical security story | Highest build/iteration cost; bottleneck is the portal API, not the server |
| Python (official `mcp` package) | Fine | Good | Would duplicate schema validation in a second language for no benefit |

**The key insight: this MCP server is an I/O-bound proxy.** Every tool call spends its time waiting on the portal API, not computing. Language-level performance differences are irrelevant at this scale; what matters is (a) official SDK support, (b) reusing the portal's existing Zod schemas and OpenAPI registry, and (c) security discipline at the boundary. TypeScript wins all three — it can import the portal's own types, its codegen script tests with the vitest setup we already run in CI, and it adds zero new language surface to maintain.

## 5. Security model

1. **Identity is passthrough, never invented.** The server forwards the operator's BetterAuth session cookie (provided via environment variable at startup). Whatever the portal would allow that user's browser, it allows the agent — nothing more.
2. **Allowlist, not blocklist, for exposure.** Tool groups are opt-in by env flag; auth and security endpoints are hardcoded exclusions in codegen, so no configuration mistake can expose them.
3. **Confirm-before-write.** Every non-GET tool refuses to run without an explicit `confirm: true` argument, which forces the AI to declare its intent in-band before any write happens.
4. **Audit trail by default.** Every call (tool, arguments, outcome, latency) is written to a JSON-lines file independent of the MCP channel.
5. **Cookie hygiene.** The session cookie is read once at startup, never logged, never included in tool descriptions or error messages.
6. **Residual risk, stated plainly:** an MCP server lets an AI act with the operator's full permissions. Mitigations are confirmation gates, audit logging, and running the server only from trusted local clients. A shared remote deployment (Phase 3) would require a fresh security review.

## 6. Architecture at a glance

```
AI client (Claude / Cursor / Hermes)
   │  JSON-RPC over stdio
   ▼
nipp-mcp-server (TypeScript, official MCP SDK)
   │  allowlist → confirm gate → audit log
   ▼
NIPP portal API (Next.js /api/*)
   │  operator's BetterAuth session cookie
   ▼
existing auth gates → RLS → Prisma/Postgres
```

The server lives in `nipp-0111/mcp-server/` as a standalone package with its own `package.json`, so it never ships inside the Next.js bundle and can be versioned independently. The only read dependency on the portal is the generated OpenAPI spec.

## 7. Timeline

| Milestone | Duration | Exit criteria |
|---|---|---|
| Phase 1: Read-only MVP | ~1 week (part-time) | ≥50 tools listed in MCP Inspector; health + work-order list calls verified against live data; unit tests green |
| Phase 2: Mutations | ~1 week | Create/update/delete verified end-to-end with confirm gates; audit log inspected; CSRF behavior confirmed |
| Phase 3: Remote (optional) | decision-gated | Security review passed; per-org scoping design approved |

## 8. Risks & open questions

**Risks**

- *Session expiry friction* — BetterAuth cookies expire; the operator must re-copy the cookie. Mitigation: a dedicated "session expired" tool error with instructions.
- *Tool count vs. LLM context* — ~160 tools is heavy for some clients. Mitigation: phased groups keep the default surface around 120 read-only tools; admin writes off by default.
- *Duplicate endpoints* — `/api/admin/*` and `/api/dashboard/admin/*` overlap; codegen must disambiguate names (both are exposed, under distinct names).
- *Prompt-injected client* — the operator's session is only as safe as the client running it. Mitigation: trusted local clients only in Phases 1–2.

**Open questions (need answers before Phase 2)**

1. Does the portal enforce CSRF tokens on cookie-authed non-GET requests? (Check `lib/csrf.ts` and the BetterAuth config in `lib/auth.ts`.) If yes, the client forwards one additional header — small work, but must be verified.
2. Should read-only admin tools be on by default, or opt-in like mutations?
3. Is a shared remote server ever wanted, or strictly per-operator local?

## 9. Recommendation

Proceed with **Phase 1 (read-only MVP) in TypeScript**, ~7h of work, touching no existing portal files. It delivers immediate value (natural-language queries over the whole portfolio), validates the codegen pipeline, and carries zero write risk. Phase 2 decisions follow after CSRF verification and a week of real usage.

---

*Companion document: full implementation plan with bite-sized TDD tasks lives at `nipp-ai/.hermes/plans/2026-11-06_115202-mcp-server-proposal-and-plan.md`.*
