-- Stage 11: affiliate links. No table changes — integrity rules Prisma can't express.

-- Outbound links are https only; codes are short and URL-safe (see src/server/affiliate/codes.ts).
ALTER TABLE "AffiliateLink" ADD CONSTRAINT "AffiliateLink_destination_https" CHECK ("destinationUrl" LIKE 'https://%');
ALTER TABLE "AffiliateLink" ADD CONSTRAINT "AffiliateLink_code_format" CHECK ("code" ~ '^[A-Za-z0-9]{6,32}$');

-- At most one product-level link (no deal) per product; ingestion keeps it up to date.
CREATE UNIQUE INDEX "AffiliateLink_one_per_product"
  ON "AffiliateLink" ("productId")
  WHERE "productId" IS NOT NULL AND "dealId" IS NULL;
