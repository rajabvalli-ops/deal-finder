-- CreateEnum
CREATE TYPE "PointsReason" AS ENUM ('CHECK_IN', 'VOTE', 'COMMENT');

-- CreateTable
CREATE TABLE "PointsEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" "PointsReason" NOT NULL,
    "refKey" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "day" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointsEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PointsEntry_userId_createdAt_idx" ON "PointsEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PointsEntry_userId_reason_day_idx" ON "PointsEntry"("userId", "reason", "day");

-- CreateIndex
CREATE UNIQUE INDEX "PointsEntry_userId_reason_refKey_key" ON "PointsEntry"("userId", "reason", "refKey");

-- AddForeignKey
ALTER TABLE "PointsEntry" ADD CONSTRAINT "PointsEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PointsEntry" ADD CONSTRAINT "PointsEntry_points_positive" CHECK ("points" > 0);
ALTER TABLE "PointsEntry" ADD CONSTRAINT "PointsEntry_day_format" CHECK ("day" ~ '^\d{4}-\d{2}-\d{2}$');
