"use server";

import { revalidatePath } from "next/cache";
import { retailerUpdateSchema } from "@/lib/validation/admin";
import {
  amazonAsinsFormSchema,
  amazonSearchFormSchema,
  amazonSearchRemoveSchema,
  parseAsinList,
} from "@/lib/validation/amazon";
import { requireRole } from "@/server/auth";
import { adminCatalogue } from "@/server/services/admin";
import { backTo, formObject } from "../_lib/redirect";

export async function updateRetailer(formData: FormData): Promise<void> {
  const actor = await requireRole("ADMIN", "/admin/retailers");
  const parsed = retailerUpdateSchema.safeParse(formObject(formData));
  if (!parsed.success) backTo(null, "/admin/retailers", { error: "INVALID_INPUT" });
  const result = await adminCatalogue.updateRetailer({ actor, ...parsed.data, now: new Date() });
  // Refresh cached public pages as well as the admin.
  revalidatePath("/", "layout");
  backTo(null, "/admin/retailers", result.ok ? { notice: "saved" } : { error: result.error });
}

function backToTracking(retailerId: string, params: Record<string, string>): never {
  backTo(`/admin/retailers/${encodeURIComponent(retailerId)}`, "/admin/retailers", params);
}

export async function updateAmazonAsins(formData: FormData): Promise<void> {
  const actor = await requireRole("ADMIN", "/admin/retailers");
  const parsed = amazonAsinsFormSchema.safeParse(formObject(formData));
  if (!parsed.success) backTo(null, "/admin/retailers", { error: "INVALID_INPUT" });
  const { retailerId } = parsed.data;
  const { asins, invalid } = parseAsinList(parsed.data.asins);
  if (invalid.length > 0) backToTracking(retailerId, { error: "INVALID_ASINS" });
  const result = await adminCatalogue.updateAmazonTracking({
    actor,
    retailerId,
    change: { kind: "asins", asins },
    now: new Date(),
  });
  backToTracking(retailerId, result.ok ? { notice: "saved" } : { error: result.error });
}

export async function addAmazonSearch(formData: FormData): Promise<void> {
  const actor = await requireRole("ADMIN", "/admin/retailers");
  const parsed = amazonSearchFormSchema.safeParse(formObject(formData));
  const retailerId = String(formData.get("retailerId") ?? "");
  if (!parsed.success) backToTracking(retailerId, { error: "INVALID_INPUT" });
  const { retailerId: id, ...search } = parsed.data;
  const result = await adminCatalogue.updateAmazonTracking({
    actor,
    retailerId: id,
    change: { kind: "add-search", search },
    now: new Date(),
  });
  backToTracking(id, result.ok ? { notice: "created" } : { error: result.error });
}

export async function removeAmazonSearch(formData: FormData): Promise<void> {
  const actor = await requireRole("ADMIN", "/admin/retailers");
  const parsed = amazonSearchRemoveSchema.safeParse(formObject(formData));
  if (!parsed.success) backTo(null, "/admin/retailers", { error: "INVALID_INPUT" });
  const { retailerId, index } = parsed.data;
  const result = await adminCatalogue.updateAmazonTracking({
    actor,
    retailerId,
    change: { kind: "remove-search", index },
    now: new Date(),
  });
  backToTracking(retailerId, result.ok ? { notice: "saved" } : { error: result.error });
}
