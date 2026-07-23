-- CreateEnum
CREATE TYPE "MemberTier" AS ENUM ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM');

-- CreateEnum
CREATE TYPE "LoyaltyCampaignType" AS ENUM ('MULTIPLIER', 'BONUS_POINTS');

-- CreateEnum
CREATE TYPE "RewardsFundEntryType" AS ENUM ('COMMISSION_CONTRIBUTION', 'REDEMPTION', 'EXPIRY_CREDIT', 'MANUAL_TOP_UP', 'ADJUSTMENT');

-- AlterTable: convert memberTier from free text to the MemberTier enum in
-- place. The old column held 'Standard' | 'Gold' | 'Platinum' (and 'GOLD' from
-- the review seed), so map those rather than dropping the column and losing
-- every customer's tier.
ALTER TABLE "CustomerProfile" ADD COLUMN "tierReviewedAt" TIMESTAMP(3);

ALTER TABLE "CustomerProfile" ALTER COLUMN "memberTier" DROP DEFAULT;

ALTER TABLE "CustomerProfile"
  ALTER COLUMN "memberTier" TYPE "MemberTier"
  USING (
    CASE upper("memberTier")
      WHEN 'PLATINUM' THEN 'PLATINUM'
      WHEN 'GOLD' THEN 'GOLD'
      WHEN 'SILVER' THEN 'SILVER'
      ELSE 'BRONZE'
    END
  )::"MemberTier";

ALTER TABLE "CustomerProfile" ALTER COLUMN "memberTier" SET DEFAULT 'BRONZE';
ALTER TABLE "CustomerProfile" ALTER COLUMN "memberTier" SET NOT NULL;

-- AlterTable
ALTER TABLE "LoyaltyTransaction" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "pointsRemaining" INTEGER;

-- CreateTable
CREATE TABLE "LoyaltyCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "LoyaltyCampaignType" NOT NULL DEFAULT 'MULTIPLIER',
    "value" INTEGER NOT NULL,
    "categories" "ProviderCategory"[],
    "minSpendMinor" INTEGER NOT NULL DEFAULT 0,
    "firstOrderOnly" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardsFundEntry" (
    "id" TEXT NOT NULL,
    "type" "RewardsFundEntryType" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "balanceAfterMinor" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardsFundEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoyaltyCampaign_isActive_startsAt_endsAt_idx" ON "LoyaltyCampaign"("isActive", "startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "RewardsFundEntry_idempotencyKey_key" ON "RewardsFundEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "RewardsFundEntry_type_createdAt_idx" ON "RewardsFundEntry"("type", "createdAt");

-- CreateIndex
CREATE INDEX "LoyaltyTransaction_accountId_type_expiresAt_idx" ON "LoyaltyTransaction"("accountId", "type", "expiresAt");

