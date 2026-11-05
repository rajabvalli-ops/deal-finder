import { z } from "zod";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const slug = z.string().max(200).regex(SLUG);

/** 1 = hot, -1 = cold, 0 = take the vote back. */
export const voteSchema = z.object({
  slug,
  value: z.union([z.literal(1), z.literal(0), z.literal(-1)]),
});

export const voteStateSchema = z.object({ slug });
