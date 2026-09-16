-- Background Job Scheduler (job-scheduler-service)
--
-- Adds the platform-org-only job scheduler data model plus the JOB
-- notification priority emitted by the scheduler's success/failure paths.
--
-- Safe to apply to a live DB: only adds a new enum value and two new tables
-- (with indexes + a cascade FK). No existing data is altered.

-- AlterEnum: JOB is emitted by the job scheduler (success/failure signals).
ALTER TYPE "NotificationPriority" ADD VALUE 'JOB';

-- CreateTable: job definitions (one row per scheduled job, platform-org scoped)
CREATE TABLE "JobDefinition" (
    "id" TEXT NOT NULL,
    "platformOrgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "handlerKey" TEXT NOT NULL,
    "code" TEXT,
    "scheduleExpr" TEXT NOT NULL,
    "timezone" TEXT,
    "timeoutMs" INTEGER,
    "concurrencyLimit" INTEGER DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lastRunAt" TIMESTAMP(3),
    "lastRunStatus" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable: execution history (one row per run of a JobDefinition)
CREATE TABLE "JobExecution" (
    "id" TEXT NOT NULL,
    "jobDefinitionId" TEXT NOT NULL,
    "platformOrgId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "actorId" TEXT,
    "error" TEXT,
    "resultJson" JSONB,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: enable/disable lookups by the engine scanner
CREATE INDEX "JobDefinition_platformOrgId_enabled_idx" ON "JobDefinition"("platformOrgId", "enabled");

-- CreateIndex: claim gate / due-job queries (lastRunAt)
CREATE INDEX "JobDefinition_platformOrgId_lastRunAt_idx" ON "JobDefinition"("platformOrgId", "lastRunAt");

-- CreateIndex: unique job name within a platform org
CREATE UNIQUE INDEX "JobDefinition_platformOrgId_name_key" ON "JobDefinition"("platformOrgId", "name");

-- CreateIndex: execution-history lookups by job (newest first)
CREATE INDEX "JobExecution_jobDefinitionId_startedAt_idx" ON "JobExecution"("jobDefinitionId", "startedAt");

-- CreateIndex: execution-history lookups by org + status
CREATE INDEX "JobExecution_platformOrgId_status_idx" ON "JobExecution"("platformOrgId", "status");

-- AddForeignKey: execution history cascades when a job definition is deleted
ALTER TABLE "JobExecution" ADD CONSTRAINT "JobExecution_jobDefinitionId_fkey" FOREIGN KEY ("jobDefinitionId") REFERENCES "JobDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
