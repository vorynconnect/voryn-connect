-- CreateEnum
CREATE TYPE "LoyaltyEntryStatus" AS ENUM ('PENDING', 'AVAILABLE', 'VOIDED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EarningStatus" ADD VALUE 'RESERVED';
ALTER TYPE "EarningStatus" ADD VALUE 'ON_HOLD';

-- AlterEnum
ALTER TYPE "PayoutStatus" ADD VALUE 'CANCELLED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SettlementEntryType" ADD VALUE 'WITHDRAWAL_FEE';
ALTER TYPE "SettlementEntryType" ADD VALUE 'REFUND';

-- DropIndex
DROP INDEX "ProviderPayout_providerId_idx";

-- AlterTable
ALTER TABLE "LoyaltyAccount" ADD COLUMN     "pendingPoints" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "LoyaltyTransaction" ADD COLUMN     "status" "LoyaltyEntryStatus" NOT NULL DEFAULT 'AVAILABLE';

-- AlterTable
ALTER TABLE "ProviderEarning" ADD COLUMN     "category" "ProviderCategory",
ADD COLUMN     "payoutId" TEXT;

-- AlterTable
ALTER TABLE "ProviderPayout" ADD COLUMN     "destination" TEXT,
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "feeMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "method" TEXT NOT NULL DEFAULT 'bank_transfer',
ADD COLUMN     "reservedMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "LoyaltyTransaction_accountId_status_referenceId_idx" ON "LoyaltyTransaction"("accountId", "status", "referenceId");

-- CreateIndex
CREATE INDEX "ProviderEarning_payoutId_idx" ON "ProviderEarning"("payoutId");

-- CreateIndex
CREATE INDEX "ProviderEarning_category_createdAt_idx" ON "ProviderEarning"("category", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderPayout_idempotencyKey_key" ON "ProviderPayout"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ProviderPayout_providerId_status_idx" ON "ProviderPayout"("providerId", "status");

