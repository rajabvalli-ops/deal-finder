"use server";

import { revalidatePath } from "next/cache";
import { userRoleSchema } from "@/lib/validation/admin";
import { requireRole } from "@/server/auth";
import { adminUsers } from "@/server/services/admin";
import { backTo, formObject } from "../_lib/redirect";

export async function setUserRole(formData: FormData): Promise<void> {
  const actor = await requireRole("ADMIN", "/admin/users");
  const returnTo = formData.get("returnTo");
  const parsed = userRoleSchema.safeParse(formObject(formData));
  if (!parsed.success) backTo(returnTo, "/admin/users", { error: "INVALID_INPUT" });
  const result = await adminUsers.setRole({ actor, ...parsed.data, now: new Date() });
  // Refresh cached public pages as well as the admin.
  revalidatePath("/", "layout");
  backTo(returnTo, "/admin/users", result.ok ? { notice: "saved" } : { error: result.error });
}
