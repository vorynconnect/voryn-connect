-- CreateEnum
CREATE TYPE "EarningStatus" AS ENUM ('PENDING', 'AVAILABLE', 'PAID', 'REVERSED');

-- CreateEnum
CREATE TYPE "RewardFunding" AS ENUM ('VORYN_FUNDED', 'MERCHANT_FUNDED', 'SHARED');

-- CreateEnum
CREATE TYPE "SettlementEntryType" AS ENUM ('CUSTOMER_PAYMENT', 'MERCHANT_GROSS_SALE', 'MERCHANT_FUNDED_DISCOUNT', 'VORYN_FUNDED_DISCOUNT', 'VORYN_COMMISSION', 'PROVIDER_NET_EARNING', 'DELIVERY_FEE', 'COURIER_EARNING', 'VORYN_DELIVERY_MARGIN', 'SERVICE_FEE', 'TIP', 'TAX', 'POINTS_EARNED', 'POINTS_REDEEMED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "pointsDiscountMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pointsEarned" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pointsRedeemed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rewardFunding" "RewardFunding" NOT NULL DEFAULT 'VORYN_FUNDED';

-- AlterTable
ALTER TABLE "Provider" ADD COLUMN     "commissionBps" INTEGER;

-- CreateTable
CREATE TABLE "ProviderEarning" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "grossMinor" INTEGER NOT NULL,
    "commissionBps" INTEGER NOT NULL,
    "commissionMinor" INTEGER NOT NULL,
    "netMinor" INTEGER NOT NULL,
    "status" "EarningStatus" NOT NULL DEFAULT 'PENDING',
    "availableAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderEarning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementRecord" (
    "id" TEXT NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "entryType" "SettlementEntryType" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderEarning_providerId_status_availableAt_idx" ON "ProviderEarning"("providerId", "status", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderEarning_referenceType_referenceId_key" ON "ProviderEarning"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "SettlementRecord_referenceType_referenceId_idx" ON "SettlementRecord"("referenceType", "referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementRecord_referenceType_referenceId_entryType_key" ON "SettlementRecord"("referenceType", "referenceId", "entryType");

-- AddForeignKey
ALTER TABLE "ProviderEarning" ADD CONSTRAINT "ProviderEarning_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
