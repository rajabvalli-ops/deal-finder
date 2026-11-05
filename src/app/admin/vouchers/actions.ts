"use server";

import { revalidatePath } from "next/cache";
import { voucherActionSchema, voucherFormSchema } from "@/lib/validation/vouchers";
import { requireRole } from "@/server/auth";
import { vouchers } from "@/server/services/vouchers";
import { backTo, formObject } from "../_lib/redirect";

export async function createVoucher(formData: FormData): Promise<void> {
  const actor = await requireRole("EDITOR", "/admin/vouchers");
  const parsed = voucherFormSchema.safeParse(formObject(formData));
  if (!parsed.success) backTo(null, "/admin/vouchers", { error: "INVALID_INPUT" });
  const result = await vouchers.create({ actor, input: parsed.data, now: new Date() });
  revalidatePath("/", "layout");
  backTo(null, "/admin/vouchers", result.ok ? { notice: "created" } : { error: result.error });
}

export async function voucherAction(formData: FormData): Promise<void> {
  const actor = await requireRole("EDITOR", "/admin/vouchers");
  const returnTo = formData.get("returnTo");
  const parsed = voucherActionSchema.safeParse(formObject(formData));
  if (!parsed.success) backTo(returnTo, "/admin/vouchers", { error: "INVALID_INPUT" });
  const result = await vouchers.change({ actor, ...parsed.data, now: new Date() });
  revalidatePath("/", "layout");
  backTo(returnTo, "/admin/vouchers", result.ok ? { notice: "saved" } : { error: result.error });
}
