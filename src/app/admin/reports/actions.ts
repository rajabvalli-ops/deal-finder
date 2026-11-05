"use server";

import { revalidatePath } from "next/cache";
import { reportCloseSchema } from "@/lib/validation/vouchers";
import { requireRole } from "@/server/auth";
import { reports } from "@/server/services/reports";
import { backTo, formObject } from "../_lib/redirect";

export async function closeReports(formData: FormData): Promise<void> {
  const actor = await requireRole("EDITOR", "/admin/reports");
  const parsed = reportCloseSchema.safeParse(formObject(formData));
  if (!parsed.success) backTo(null, "/admin/reports", { error: "INVALID_INPUT" });
  const result = await reports.close({
    actor,
    targetId: parsed.data.targetId,
    outcome: parsed.data.outcome === "dismiss" ? "DISMISSED" : "RESOLVED",
    now: new Date(),
  });
  revalidatePath("/admin", "layout");
  backTo(null, "/admin/reports", result.ok ? { notice: "saved" } : { error: result.error });
}
