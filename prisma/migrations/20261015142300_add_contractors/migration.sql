-- CreateEnum: ContractorType (matches prisma/schema.prisma `enum ContractorType`)
CREATE TYPE "ContractorType" AS ENUM ('PAINTER', 'ELECTRICIAN', 'PLUMBER', 'GAS_ENGINEER', 'LIFT_MAINTENANCE', 'GARDENER', 'ACCOUNTANT', 'FIRE_ALARMS', 'SOLICITOR', 'ROOFER', 'WINDOW_CLEANER', 'OTHER');

-- CreateTable: Contractors — global shared contractor directory (NOT org-scoped, no RLS).
-- Deterministic Prisma DDL for the schema change (same output as
-- `prisma migrate dev --name add_contractors`; written by hand because the
-- dev DB role cannot create a shadow database — same practice as
-- 20261014143000_add_units).
CREATE TABLE "Contractors" (
    "contractorId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "postCode" TEXT NOT NULL,
    "type" "ContractorType" NOT NULL DEFAULT 'OTHER',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contractors_pkey" PRIMARY KEY ("contractorId")
);
