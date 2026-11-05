"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import type { ReportState } from "@/components/public/report-problem";
import { reportFormSchema } from "@/lib/validation/vouchers";
import { getCurrentUser } from "@/server/auth";
import { clientIp } from "@/server/affiliate";
import { reports } from "@/server/services/reports";

/** "Report a problem" on a deal or voucher. Anyone can report; it's rate-limited per person. */
export async function reportProblem(_state: ReportState, formData: FormData): Promise<ReportState> {
  const parsed = reportFormSchema.safeParse({
    target: formData.get("target"),
    id: formData.get("id"),
    reason: formData.get("reason"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) return { status: "error" };
  const [user, requestHeaders] = await Promise.all([getCurrentUser(), headers()]);
  const result = await reports.submit({
    input: parsed.data,
    userId: user?.id ?? null,
    ip: clientIp(requestHeaders),
    now: new Date(),
  });
  if (!result.ok) return { status: result.error === "RATE_LIMITED" ? "limited" : "gone" };
  // A voucher hidden by reports must disappear from the cached pages at once.
  if (result.hidden) revalidatePath("/", "layout");
  return { status: "sent" };
}
