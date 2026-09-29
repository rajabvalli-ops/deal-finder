"use server";

import { revalidatePath } from "next/cache";
import { dealActionSchema, dealContentSchema } from "@/lib/validation/admin";
import { requireRole } from "@/server/auth";
import { adminDeals } from "@/server/services/admin";
import { backTo, formObject } from "../_lib/redirect";

export async function dealAction(formData: FormData): Promise<void> {
  const actor = await requireRole("EDITOR", "/admin/deals");
  const returnTo = formData.get("returnTo");
  const parsed = dealActionSchema.safeParse(formObject(formData));
  if (!parsed.success) backTo(returnTo, "/admin/deals", { error: "INVALID_INPUT" });

  const { dealId, action, reason } = parsed.data;
  const result = await adminDeals.applyAction({ actor, dealId, action, reason, now: new Date() });
  revalidatePath("/admin", "layout");
  backTo(
    returnTo,
    `/admin/deals/${dealId}`,
    result.ok ? { notice: action } : { error: result.error },
  );
}

export async function updateDealContent(formData: FormData): Promise<void> {
  const actor = await requireRole("EDITOR", "/admin/deals");
  const returnTo = formData.get("returnTo");
  const parsed = dealContentSchema.safeParse(formObject(formData));
  if (!parsed.success) backTo(returnTo, "/admin/deals", { error: "INVALID_INPUT" });

  const { dealId, ...content } = parsed.data;
  const result = await adminDeals.updateContent({ actor, dealId, content, now: new Date() });
  revalidatePath("/admin", "layout");
  backTo(
    returnTo,
    `/admin/deals/${dealId}`,
    result.ok ? { notice: "saved" } : { error: result.error },
  );
}
