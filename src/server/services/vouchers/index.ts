import "server-only";
import { db } from "@/server/db/client";
import { createVouchersService } from "./vouchers.service";

export type { VoucherView } from "./vouchers.service";

export const vouchers = createVouchersService(db);
