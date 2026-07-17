-- AlterTable
ALTER TABLE "RideRequest" ADD COLUMN     "quoteId" TEXT;

-- CreateTable
CREATE TABLE "RideQuote" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "pickupName" TEXT NOT NULL,
    "pickupLat" DOUBLE PRECISION NOT NULL,
    "pickupLng" DOUBLE PRECISION NOT NULL,
    "dropoffName" TEXT NOT NULL,
    "dropoffLat" DOUBLE PRECISION NOT NULL,
    "dropoffLng" DOUBLE PRECISION NOT NULL,
    "distanceKm" DOUBLE PRECISION NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "fares" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RideQuote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RideQuote_customerId_createdAt_idx" ON "RideQuote"("customerId", "createdAt");

-- AddForeignKey
ALTER TABLE "RideRequest" ADD CONSTRAINT "RideRequest_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "RideQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideQuote" ADD CONSTRAINT "RideQuote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
