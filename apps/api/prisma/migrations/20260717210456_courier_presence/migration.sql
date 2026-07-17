-- AlterTable
ALTER TABLE "CourierProfile" ADD COLUMN     "lastHeading" DOUBLE PRECISION,
ADD COLUMN     "lastLat" DOUBLE PRECISION,
ADD COLUMN     "lastLng" DOUBLE PRECISION,
ADD COLUMN     "lastLocationAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "CourierProfile_isOnline_lastLocationAt_idx" ON "CourierProfile"("isOnline", "lastLocationAt");
