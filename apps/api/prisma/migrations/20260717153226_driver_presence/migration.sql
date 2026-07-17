-- AlterTable
ALTER TABLE "DriverProfile" ADD COLUMN     "lastHeading" DOUBLE PRECISION,
ADD COLUMN     "lastLat" DOUBLE PRECISION,
ADD COLUMN     "lastLng" DOUBLE PRECISION,
ADD COLUMN     "lastLocationAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "DriverProfile_isOnline_rideCategory_lastLocationAt_idx" ON "DriverProfile"("isOnline", "rideCategory", "lastLocationAt");
