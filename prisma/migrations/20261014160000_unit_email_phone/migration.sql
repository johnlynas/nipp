-- ============================================================
-- Units: add contact fields (email, phone) for the unit owner.
-- Required string columns — existing rows are backfilled from the
-- transient default and then have it dropped so new inserts must
-- carry explicit values (schema has no @default).
-- ============================================================

ALTER TABLE "Units" ADD COLUMN "email" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Units" ADD COLUMN "phone" TEXT NOT NULL DEFAULT '';

ALTER TABLE "Units" ALTER COLUMN "email" DROP DEFAULT;
ALTER TABLE "Units" ALTER COLUMN "phone" DROP DEFAULT;
