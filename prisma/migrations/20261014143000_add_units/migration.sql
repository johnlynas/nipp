-- CreateEnum: UnitType (matches prisma/schema.prisma `enum UnitType`)
CREATE TYPE "UnitType" AS ENUM ('HOUSE', 'APARTMENT', 'OTHER');

-- CreateTable: Units — org-scoped properties (1:M from Organization).
-- Deterministic Prisma DDL for the schema change (same output as
-- `prisma migrate dev --name add_units`). The live dev DB already carries this
-- table; this file keeps the fresh-`migrate deploy` chain in sync.
CREATE TABLE "Units" (
    "unitId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "postCode" TEXT NOT NULL,
    "rented" BOOLEAN NOT NULL DEFAULT false,
    "type" "UnitType" NOT NULL DEFAULT 'APARTMENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Units_pkey" PRIMARY KEY ("unitId")
);

-- CreateIndex: tenant-scoped lookups (RLS + app-layer scoping column).
CREATE INDEX "Units_organizationId_idx" ON "Units"("organizationId");

-- AddForeignKey: 1:M to Organization with cascade delete.
ALTER TABLE "Units" ADD CONSTRAINT "Units_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
