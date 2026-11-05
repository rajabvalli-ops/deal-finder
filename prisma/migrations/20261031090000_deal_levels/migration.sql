-- Stage 14: deal levels (big drops, possible price errors), level alerts and auto-publish.

CREATE TYPE "DealLevel" AS ENUM ('NORMAL', 'BIG_DROP', 'PRICE_ERROR');

ALTER TABLE "Deal"
  ADD COLUMN "level" "DealLevel" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "levelRaisedAt" TIMESTAMPTZ(3);

ALTER TABLE "Alert" ADD COLUMN "minLevel" "DealLevel";

ALTER TABLE "Retailer" ADD COLUMN "autoPublish" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Deal_status_level_publishedAt_idx" ON "Deal"("status", "level", "publishedAt");

-- An alert may now watch "every big drop / price error" without a keyword, product or category.
ALTER TABLE "Alert" DROP CONSTRAINT "Alert_has_criterion";
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_has_criterion" CHECK (
  "keyword" IS NOT NULL OR "productId" IS NOT NULL OR "categoryId" IS NOT NULL OR "minLevel" IS NOT NULL
);
