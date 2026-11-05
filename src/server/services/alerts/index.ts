import "server-only";
import { db } from "@/server/db/client";
import { createAlertMatchingService } from "./alert-matching.service";
import { createAlertsService } from "./alerts.service";
import { pushConfigFromEnv } from "@/server/push/web-push";
import { pushDeliveryFromEnv } from "./push-delivery.service";

export {
  ALERT_ERROR_MESSAGES,
  type AlertErrorCode,
  type AlertView,
  type NotificationView,
} from "./alerts.service";

export const alerts = createAlertsService(db);
export const alertMatching = createAlertMatchingService(db, {
  push: pushDeliveryFromEnv(db, process.env),
});

/** The VAPID public key browsers subscribe with, or null when push is turned off. */
export function pushPublicKey(): string | null {
  return pushConfigFromEnv(process.env)?.publicKey ?? null;
}
