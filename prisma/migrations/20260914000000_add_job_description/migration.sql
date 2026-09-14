-- Job Scheduler — Script description
--
-- Adds an optional free-text `description` to JobDefinition so platform admins
-- can document what a custom script does.
--
-- Safe to apply to a live DB: only adds a nullable column.

ALTER TABLE "JobDefinition" ADD COLUMN "description" TEXT;
