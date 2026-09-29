"use server";

import { revalidatePath } from "next/cache";
import { categorySchema, categoryUpdateSchema } from "@/lib/validation/admin";
import { requireRole } from "@/server/auth";
import { adminCatalogue } from "@/server/services/admin";
import { backTo, formObject } from "../_lib/redirect";

export async function createCategory(formData: FormData): Promise<void> {
  const actor = await requireRole("ADMIN", "/admin/categories");
  const parsed = categorySchema.safeParse(formObject(formData));
  if (!parsed.success) backTo(null, "/admin/categories", { error: "INVALID_INPUT" });
  const result = await adminCatalogue.createCategory({
    actor,
    input: parsed.data,
    now: new Date(),
  });
  revalidatePath("/admin", "layout");
  backTo(null, "/admin/categories", result.ok ? { notice: "created" } : { error: result.error });
}

export async function updateCategory(formData: FormData): Promise<void> {
  const actor = await requireRole("ADMIN", "/admin/categories");
  const parsed = categoryUpdateSchema.safeParse(formObject(formData));
  if (!parsed.success) backTo(null, "/admin/categories", { error: "INVALID_INPUT" });
  const { categoryId, ...input } = parsed.data;
  const result = await adminCatalogue.updateCategory({ actor, categoryId, input, now: new Date() });
  revalidatePath("/admin", "layout");
  backTo(null, "/admin/categories", result.ok ? { notice: "saved" } : { error: result.error });
}
