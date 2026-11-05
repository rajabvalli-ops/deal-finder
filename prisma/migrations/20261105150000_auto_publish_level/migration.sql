-- Auto-publish by level: price errors (or big drops) can go live instantly while ordinary
-- deals still wait for review. Retailers that auto-published everything keep doing so.

ALTER TABLE "Retailer" ADD COLUMN "autoPublishLevel" "DealLevel";
UPDATE "Retailer" SET "autoPublishLevel" = 'NORMAL' WHERE "autoPublish";
ALTER TABLE "Retailer" DROP COLUMN "autoPublish";
