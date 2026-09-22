/**
 * RLS GUC context builder — the ONLY place app.current_* session variables are composed.
 *
 * PostgreSQL Row Level Security policies read these per-session settings:
 *   app.current_user_id       verified BetterAuth user id (server-derived, never client input)
 *   app.current_org_id        target organization for this request (verified membership, or
 *                             the org a super admin is acting on)
 *   app.is_platform_admin     '1' when the caller is a verified platform-org member
 *   app.platform_org_id       platform org id; read ONLY by JobDefinition/JobExecution
 *                             policies. Optional — omitted (left untouched) for ordinary
 *                             tenant requests, set by the platform-admin job-scheduler path.
 *
 * The returned SQL MUST be executed at the start of an interactive Prisma transaction
 * on the SAME connection the guarded query runs on (set_config local=true keeps each GUC
 * scoped to that transaction, so pooling cannot leak context between requests). This is
 * wired in lib/tenant-db.ts. No route/service may import this module directly — enforced
 * by Phase 4 ESLint guardrails.
 */
export interface RLSContext {
  userId: string;
  orgId: string;
  isPlatformAdmin: boolean;
  /**
   * Platform org id for the JobDefinition/JobExecution policies. Only needed
   * by platform-admin (job-scheduler) operations; omit for ordinary tenant
   * requests (the GUC is then left unset, and no policy reads it).
   */
  platformOrgId?: string;
}

function escapeSingleQuotes(s: string): string {
  return s.replace(/'/g, "''");
}

/**
 * Build a single statement that sets the RLS GUCs transaction-locally.
 * The app.platform_org_id set_config is emitted only when platformOrgId is
 * provided, so ordinary tenant requests never touch job-table context.
 */
export function buildRLSContextQueries(c: RLSContext): string {
  const userId = escapeSingleQuotes(c.userId);
  const orgId = escapeSingleQuotes(c.orgId);
  const flag = c.isPlatformAdmin ? '1' : '0';
  const exprs = [
    `set_config('app.current_user_id', '${userId}', true)`,
    `set_config('app.current_org_id', '${orgId}', true)`,
    `set_config('app.is_platform_admin', '${flag}', true)`,
  ];
  if (c.platformOrgId !== undefined && c.platformOrgId !== '') {
    exprs.push(`set_config('app.platform_org_id', '${escapeSingleQuotes(c.platformOrgId)}', true)`);
  }
  return `SELECT ${exprs.join(',\n       ')}`;
}
