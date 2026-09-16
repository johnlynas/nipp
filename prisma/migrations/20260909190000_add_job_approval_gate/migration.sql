-- Job Scheduler — Approval gate
--
-- Adds a general approval guardrail to JobDefinition. A job cannot be enabled,
-- manually triggered, or run on its schedule until a platform admin explicitly
-- approves it (approved=true). This ensures a newly created job — including a
-- future operator-authored `code` job (Phase 2) — never executes unreviewed.
--
-- Safe to apply to a live DB: only adds nullable columns (approved defaults to
-- false, so existing jobs are gated until explicitly approved) plus one index.

ALTER TABLE "JobDefinition" ADD COLUMN "approved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "JobDefinition" ADD COLUMN "approvedBy" TEXT;
ALTER TABLE "JobDefinition" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "JobDefinition" ADD COLUMN "approvalNote" TEXT;

CREATE INDEX "JobDefinition_platformOrgId_approved_idx" ON "JobDefinition"("platformOrgId", "approved");
