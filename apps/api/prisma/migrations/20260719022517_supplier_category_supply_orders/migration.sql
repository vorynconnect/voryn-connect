-- CreateEnum
CREATE TYPE "SupplyOrderStatus" AS ENUM ('PLACED', 'CONFIRMED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "ProviderCategory" ADD VALUE 'SUPPLIER';

-- CreateTable
CREATE TABLE "SupplyOrder" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "status" "SupplyOrderStatus" NOT NULL DEFAULT 'PLACED',
    "note" TEXT,
    "subtotalMinor" INTEGER NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyOrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "unitPriceMinor" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "SupplyOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplyOrder_code_key" ON "SupplyOrder"("code");

-- CreateIndex
CREATE INDEX "SupplyOrder_supplierId_status_idx" ON "SupplyOrder"("supplierId", "status");

-- CreateIndex
CREATE INDEX "SupplyOrder_buyerId_status_idx" ON "SupplyOrder"("buyerId", "status");

-- AddForeignKey
ALTER TABLE "SupplyOrder" ADD CONSTRAINT "SupplyOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyOrder" ADD CONSTRAINT "SupplyOrder_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyOrderItem" ADD CONSTRAINT "SupplyOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SupplyOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
