-- Better Auth 1.7 schema alignment (org plugin + teams enabled).
-- See .hermes/plans/2026-10-31_133136-npm-audit-phased-remediation.md — Phase 2.
--
-- 1.7's runtime schema check (SCHEMA_MISMATCH) requires:
--   * member.organizationId / invitation.organizationId  (renamed from orgId)
--   * session.activeOrganizationId + session.activeTeamId
--   * organization.logo, team.memberCount, teamMember.membershipKey
--   * invitation.status + invitation.inviterId; invitation.token removed
--   * teamMember.organizationId no longer written by the plugin -> must be nullable
-- RENAME COLUMN is used (rather than drop+add) so foreign keys, unique indexes and
-- the rls_member_isolated / rls_invitation_isolated policies keep working untouched.

-- Rename org ownership columns (Postgres carries constraints/indexes/policies along).
ALTER TABLE "Member" RENAME COLUMN "orgId" TO "organizationId";
ALTER TABLE "Invitation" RENAME COLUMN "orgId" TO "organizationId";

-- Core/session additions.
ALTER TABLE "Session" ADD COLUMN "activeOrganizationId" TEXT;
ALTER TABLE "Session" ADD COLUMN "activeTeamId" TEXT;

ALTER TABLE "Organization" ADD COLUMN "logo" TEXT;

-- Team seat counter; backfilled below from real membership counts.
ALTER TABLE "Team" ADD COLUMN "memberCount" INTEGER NOT NULL DEFAULT 0;
UPDATE "Team" t SET "memberCount" = (
  SELECT count(*) FROM "TeamMember" m WHERE m."teamId" = t.id
);

-- Invitation alignment with the 1.7 plugin writes.
DROP INDEX "Invitation_token_key";
ALTER TABLE "Invitation" DROP COLUMN "token",
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN "inviterId" TEXT;

-- TeamMember: make org nullable (plugin derives it from the team) and relax FK.
ALTER TABLE "TeamMember" ALTER COLUMN "organizationId" DROP NOT NULL;
ALTER TABLE "TeamMember" DROP CONSTRAINT "TeamMember_organizationId_fkey";
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- membershipKey added nullable here; the backfill script
-- (scripts/backfill-team-membership-key.ts) computes 1.7's canonical key, and the
-- follow-up migration 20261031000001 tightens it to NOT NULL + unique.
ALTER TABLE "TeamMember" ADD COLUMN "membershipKey" TEXT;
