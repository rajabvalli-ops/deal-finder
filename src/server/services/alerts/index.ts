import "server-only";
import { db } from "@/server/db/client";
import { createAlertMatchingService } from "./alert-matching.service";
import { createAlertsService } from "./alerts.service";

export {
  ALERT_ERROR_MESSAGES,
  type AlertErrorCode,
  type AlertView,
  type NotificationView,
} from "./alerts.service";

export const alerts = createAlertsService(db);
export const alertMatching = createAlertMatchingService(db);
