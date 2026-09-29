"use server";

import { revalidatePath } from "next/cache";
import { retailerUpdateSchema } from "@/lib/validation/admin";
import { requireRole } from "@/server/auth";
import { adminCatalogue } from "@/server/services/admin";
import { backTo, formObject } from "../_lib/redirect";

export async function updateRetailer(formData: FormData): Promise<void> {
  const actor = await requireRole("ADMIN", "/admin/retailers");
  const parsed = retailerUpdateSchema.safeParse(formObject(formData));
  if (!parsed.success) backTo(null, "/admin/retailers", { error: "INVALID_INPUT" });
  const result = await adminCatalogue.updateRetailer({ actor, ...parsed.data, now: new Date() });
  revalidatePath("/admin", "layout");
  backTo(null, "/admin/retailers", result.ok ? { notice: "saved" } : { error: result.error });
}
