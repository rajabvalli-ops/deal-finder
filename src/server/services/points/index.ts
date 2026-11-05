import "server-only";
import { db } from "@/server/db/client";
import { createPointsService } from "./points.service";

export type { CheckInResult, PointsSummary } from "./points.service";

export const points = createPointsService(db);
