-- AlterTable
ALTER TABLE "Provider" ADD COLUMN     "applicationSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "businessRegNo" TEXT,
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "ownerFullName" TEXT,
ADD COLUMN     "ownerIdNumber" TEXT,
ADD COLUMN     "ownerIdType" TEXT,
ADD COLUMN     "trn" TEXT;

-- AlterTable
ALTER TABLE "ProviderDocument" ADD COLUMN     "fileName" TEXT,
ADD COLUMN     "mimeType" TEXT;
