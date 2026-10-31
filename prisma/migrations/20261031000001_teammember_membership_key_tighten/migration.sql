-- Tighten teamMember.membershipKey after backfill (scripts/backfill-team-membership-key.ts).
ALTER TABLE "TeamMember" ALTER COLUMN "membershipKey" SET NOT NULL;
CREATE UNIQUE INDEX "TeamMember_membershipKey_key" ON "TeamMember" ("membershipKey");
