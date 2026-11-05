-- Stage 16: visitor reports (expired deals, codes that don't work) and voucher listing.

-- CreateEnum
CREATE TYPE "ReportTarget" AS ENUM ('DEAL', 'COUPON');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('EXPIRED', 'WRONG_PRICE', 'OUT_OF_STOCK', 'CODE_NOT_WORKING', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "target" "ReportTarget" NOT NULL,
    "targetId" TEXT NOT NULL,
    "dealId" TEXT,
    "couponId" TEXT,
    "reason" "ReportReason" NOT NULL,
    "note" TEXT,
    "userId" TEXT,
    "reporterKey" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMPTZ(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Report_status_createdAt_idx" ON "Report"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Report_targetId_status_idx" ON "Report"("targetId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Report_targetId_reporterKey_key" ON "Report"("targetId", "reporterKey");

-- CreateIndex
CREATE INDEX "Coupon_isActive_validUntil_idx" ON "Coupon"("isActive", "validUntil");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Exactly one target, and it matches `target` and `targetId`.
ALTER TABLE "Report" ADD CONSTRAINT "Report_one_target" CHECK (
  ("target" = 'DEAL' AND "dealId" IS NOT NULL AND "couponId" IS NULL AND "targetId" = "dealId")
  OR ("target" = 'COUPON' AND "couponId" IS NOT NULL AND "dealId" IS NULL AND "targetId" = "couponId")
);
ALTER TABLE "Report" ADD CONSTRAINT "Report_note_length" CHECK ("note" IS NULL OR length("note") <= 300);
-- A voucher needs something to show: a code, or a title for code-free offers (always set).
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_code_format" CHECK ("code" IS NULL OR "code" ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$');
