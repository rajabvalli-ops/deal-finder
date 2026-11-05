-- AlterTable
ALTER TABLE "Coupon" ADD COLUMN     "discountBps" INTEGER,
ADD COLUMN     "discountPence" INTEGER,
ADD COLUMN     "lastCheckedAt" TIMESTAMPTZ(3),
ADD COLUMN     "minSpendPence" INTEGER;

ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_discount" CHECK (
  NOT ("discountPence" IS NOT NULL AND "discountBps" IS NOT NULL)
  AND ("discountPence" IS NULL OR "discountPence" > 0)
  AND ("discountBps" IS NULL OR "discountBps" BETWEEN 1 AND 10000)
  AND ("minSpendPence" IS NULL OR "minSpendPence" > 0)
);
-- Existing vouchers were checked by an editor when they were added.
UPDATE "Coupon" SET "lastCheckedAt" = "createdAt";
