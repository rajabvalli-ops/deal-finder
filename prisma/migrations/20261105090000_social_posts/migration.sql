-- Stage 15: auto-posting deals to social networks (X).

-- CreateEnum
CREATE TYPE "SocialPostStatus" AS ENUM ('PENDING', 'POSTED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "SocialPost" (
    "id" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "dealId" TEXT,
    "level" "DealLevel" NOT NULL,
    "status" "SocialPostStatus" NOT NULL DEFAULT 'PENDING',
    "text" TEXT NOT NULL,
    "externalId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedAt" TIMESTAMPTZ(3),

    CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialPost_network_status_createdAt_idx" ON "SocialPost"("network", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SocialPost_network_postedAt_idx" ON "SocialPost"("network", "postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SocialPost_network_dealId_level_key" ON "SocialPost"("network", "dealId", "level");

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

