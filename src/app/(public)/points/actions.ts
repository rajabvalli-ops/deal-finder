"use server";

import { redirect } from "next/navigation";
import { requireRole } from "@/server/auth";
import { points } from "@/server/services/points";

export async function checkIn(): Promise<void> {
  const user = await requireRole("USER", "/points");
  const result = await points.checkIn(user.id, new Date());
  redirect(result.ok ? `/points?earned=${result.points}` : "/points?notice=already");
}
