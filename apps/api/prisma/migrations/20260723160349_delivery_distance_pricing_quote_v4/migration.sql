-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "additionalPickupFeeMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deliveryPackageClass" TEXT,
ADD COLUMN     "deliveryPricingVersion" INTEGER,
ADD COLUMN     "deliveryQuoteId" TEXT,
ADD COLUMN     "deliveryVehicle" TEXT,
ADD COLUMN     "demandAdjustmentMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "demandMultiplierBps" INTEGER NOT NULL DEFAULT 10000,
ADD COLUMN     "estimatedDurationSeconds" INTEGER,
ADD COLUMN     "packageAdjustmentMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "routeDistanceMeters" INTEGER,
ADD COLUMN     "vehicleAdjustmentMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "waitingFeeMinor" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "DeliveryQuote" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "merchantName" TEXT NOT NULL,
    "pickupLat" DOUBLE PRECISION NOT NULL,
    "pickupLng" DOUBLE PRECISION NOT NULL,
    "dropoffLat" DOUBLE PRECISION NOT NULL,
    "dropoffLng" DOUBLE PRECISION NOT NULL,
    "routeDistanceMeters" INTEGER NOT NULL,
    "estimatedDurationSeconds" INTEGER NOT NULL,
    "distanceKm" DOUBLE PRECISION NOT NULL,
    "vehicle" TEXT NOT NULL DEFAULT 'MOTORCYCLE',
    "packageClass" TEXT NOT NULL DEFAULT 'SMALL',
    "merchantCount" INTEGER NOT NULL DEFAULT 1,
    "baseFeeMinor" INTEGER NOT NULL,
    "distanceFeeMinor" INTEGER NOT NULL,
    "vehicleAdjustmentMinor" INTEGER NOT NULL DEFAULT 0,
    "packageAdjustmentMinor" INTEGER NOT NULL DEFAULT 0,
    "additionalPickupFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "demandMultiplierBps" INTEGER NOT NULL DEFAULT 10000,
    "demandAdjustmentMinor" INTEGER NOT NULL DEFAULT 0,
    "estimatedWaitingFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "discountMinor" INTEGER NOT NULL DEFAULT 0,
    "finalDeliveryFeeMinor" INTEGER NOT NULL,
    "courierCommissionBps" INTEGER NOT NULL,
    "estimatedCourierEarningMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'JMD',
    "pricingVersion" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryQuote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeliveryQuote_customerId_createdAt_idx" ON "DeliveryQuote"("customerId", "createdAt");

-- AddForeignKey
ALTER TABLE "DeliveryQuote" ADD CONSTRAINT "DeliveryQuote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_deliveryQuoteId_fkey" FOREIGN KEY ("deliveryQuoteId") REFERENCES "DeliveryQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
