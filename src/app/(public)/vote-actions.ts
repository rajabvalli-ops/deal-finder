"use server";

import { voteSchema, voteStateSchema } from "@/lib/validation/votes";
import { getCurrentUser } from "@/server/auth";
import { votes } from "@/server/services/votes";

// Hot / cold votes from the deal page. Returns results instead of redirecting, so the buttons
// update in place. Cached pages aren't revalidated per vote: lists catch up within minutes.

export type VoteActionResult =
  | { ok: true; score: number; myVote: -1 | 0 | 1 }
  | { ok: false; error: "SIGNED_OUT" | "INVALID" | "NOT_FOUND" | "RATE_LIMITED" };

export async function voteOnDeal(input: unknown): Promise<VoteActionResult> {
  const parsed = voteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID" };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "SIGNED_OUT" };
  return votes.vote({ userId: user.id, ...parsed.data, now: new Date() });
}

export async function dealVoteState(
  input: unknown,
): Promise<{ score: number; myVote: -1 | 0 | 1; signedIn: boolean } | null> {
  const parsed = voteStateSchema.safeParse(input);
  if (!parsed.success) return null;
  const user = await getCurrentUser();
  const state = await votes.state(parsed.data.slug, user?.id ?? null);
  return state ? { ...state, signedIn: user !== null } : null;
}
