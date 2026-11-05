-- Alerts without an account (follow every price error / big drop) and per-device quiet hours.

-- AlterTable
ALTER TABLE "PushSubscription" ADD COLUMN     "broadcastLevel" "DealLevel",
ADD COLUMN     "quietEndHour" INTEGER,
ADD COLUMN     "quietStartHour" INTEGER,
ALTER COLUMN "userId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "PushSubscription_broadcastLevel_idx" ON "PushSubscription"("broadcastLevel");


ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_quiet_hours" CHECK (
  ("quietStartHour" IS NULL AND "quietEndHour" IS NULL)
  OR ("quietStartHour" IS NOT NULL AND "quietEndHour" IS NOT NULL
      AND "quietStartHour" BETWEEN 0 AND 23 AND "quietEndHour" BETWEEN 0 AND 23)
);
-- A device with no account must follow something, or it would never get anything.
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_has_purpose" CHECK (
  "userId" IS NOT NULL OR "broadcastLevel" IS NOT NULL
);
