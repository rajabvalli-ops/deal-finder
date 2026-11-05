-- Voting ("hot" / "cold") and the Hot tab.

-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "voteScore" INTEGER NOT NULL DEFAULT 0;

-- Hot ranking, kept by Postgres (mirrors hotRank() in src/lib/hot.ts): the log of the deal's
-- points (votes, plus 10 for a possible price error or 3 for a big drop), plus the time it was
-- published in units of 12.5 hours. So a deal 12.5 hours newer ranks level with one that has
-- ten times the points. Time-independent, so it can be stored and indexed.
ALTER TABLE "Deal" ADD COLUMN "hotRank" DOUBLE PRECISION GENERATED ALWAYS AS (
  sign(("voteScore" + CASE "level" WHEN 'PRICE_ERROR' THEN 10 WHEN 'BIG_DROP' THEN 3 ELSE 0 END)::double precision)
  * log(greatest(abs("voteScore" + CASE "level" WHEN 'PRICE_ERROR' THEN 10 WHEN 'BIG_DROP' THEN 3 ELSE 0 END), 1)::double precision)
  + extract(epoch FROM ("publishedAt" - to_timestamp(1767225600)))::double precision / 45000
) STORED;

-- CreateTable
CREATE TABLE "DealVote" (
    "dealId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DealVote_pkey" PRIMARY KEY ("dealId","userId")
);

-- CreateIndex
CREATE INDEX "DealVote_userId_idx" ON "DealVote"("userId");

-- CreateIndex
CREATE INDEX "Deal_status_hotRank_idx" ON "Deal"("status", "hotRank");

-- AddForeignKey
ALTER TABLE "DealVote" ADD CONSTRAINT "DealVote_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealVote" ADD CONSTRAINT "DealVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DealVote" ADD CONSTRAINT "DealVote_value" CHECK ("value" IN (-1, 1));
