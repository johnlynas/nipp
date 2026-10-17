/*
  Warnings:

  - You are about to drop the column `access_token` on the `Account` table. All the data in the column will be lost.
  - You are about to drop the column `expires_at` on the `Account` table. All the data in the column will be lost.
  - You are about to drop the column `id_token` on the `Account` table. All the data in the column will be lost.
  - You are about to drop the column `providerAccountId` on the `Account` table. All the data in the column will be lost.
  - You are about to drop the column `refresh_token` on the `Account` table. All the data in the column will be lost.
  - You are about to drop the column `session_state` on the `Account` table. All the data in the column will be lost.
  - You are about to drop the column `token_type` on the `Account` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[providerId,accountId]` on the table `Account` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "WorkOrderState" AS ENUM ('CREATED', 'OUT_FOR_QUOTES', 'QUOTES_IN', 'CONTRACTOR_ASSIGNED', 'STARTED', 'COMPLETE', 'INVOICED', 'FINISHED', 'CLOSED');

-- CreateEnum
CREATE TYPE "QuotationState" AS ENUM ('OPENED', 'ACCEPTED', 'REJECTED', 'CLOSED');

-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_organizationId_fkey";

-- DropIndex
DROP INDEX "Account_providerId_providerAccountId_key";

-- DropIndex
DROP INDEX "Role_name_orgId_index";

-- AlterTable
ALTER TABLE "Account" DROP COLUMN "access_token",
DROP COLUMN "expires_at",
DROP COLUMN "id_token",
DROP COLUMN "providerAccountId",
DROP COLUMN "refresh_token",
DROP COLUMN "session_state",
DROP COLUMN "token_type",
ADD COLUMN     "accessToken" TEXT,
ADD COLUMN     "accessTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "idToken" TEXT,
ADD COLUMN     "refreshToken" TEXT,
ADD COLUMN     "refreshTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "sessionState" TEXT,
ADD COLUMN     "tokenType" TEXT;

-- AlterTable
ALTER TABLE "Invitation" ADD COLUMN     "teamId" TEXT;

-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "teamId" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "description" TEXT,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "mapZoom" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Permission" ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "activeOrganizationId" TEXT,
ADD COLUMN     "oidcVerified" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceRole" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resourceId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "ResourceRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrder" (
    "workOrderId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "openedBy" TEXT NOT NULL,
    "openedById" TEXT,
    "contractorId" TEXT,
    "quotesDue" TIMESTAMP(3),
    "deadlineAlertAt" TIMESTAMP(3),
    "state" "WorkOrderState" NOT NULL DEFAULT 'CREATED',
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("workOrderId")
);

-- CreateTable
CREATE TABLE "WorkOrderNote" (
    "workOrderNoteId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "WorkOrderNote_pkey" PRIMARY KEY ("workOrderNoteId")
);

-- CreateTable
CREATE TABLE "Quotation" (
    "quoteId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "quoteLink" TEXT,
    "description" TEXT,
    "price" DECIMAL(12,2),
    "dueDate" TIMESTAMP(3) NOT NULL,
    "state" "QuotationState" NOT NULL DEFAULT 'OPENED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("quoteId")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "invoiceId" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "invoiceLink" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("invoiceId")
);

-- CreateIndex
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "Resource_name_key" ON "Resource"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceRole_resourceId_roleId_key" ON "ResourceRole"("resourceId", "roleId");

-- CreateIndex
CREATE INDEX "WorkOrder_organizationId_state_idx" ON "WorkOrder"("organizationId", "state");

-- CreateIndex
CREATE INDEX "WorkOrder_organizationId_quotesDue_idx" ON "WorkOrder"("organizationId", "quotesDue");

-- CreateIndex
CREATE INDEX "WorkOrderNote_workOrderId_idx" ON "WorkOrderNote"("workOrderId");

-- CreateIndex
CREATE INDEX "Quotation_organizationId_idx" ON "Quotation"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_workOrderId_contractorId_key" ON "Quotation"("workOrderId", "contractorId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_workOrderId_key" ON "Invoice"("workOrderId");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_idx" ON "Invoice"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_providerId_accountId_key" ON "Account"("providerId", "accountId");

-- CreateIndex
CREATE INDEX "Role_name_idx" ON "Role"("name");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceRole" ADD CONSTRAINT "ResourceRole_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceRole" ADD CONSTRAINT "ResourceRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractors"("contractorId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderNote" ADD CONSTRAINT "WorkOrderNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderNote" ADD CONSTRAINT "WorkOrderNote_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("workOrderId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("workOrderId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractors"("contractorId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("workOrderId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractors"("contractorId") ON DELETE RESTRICT ON UPDATE CASCADE;
