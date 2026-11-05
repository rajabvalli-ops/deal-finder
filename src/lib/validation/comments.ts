import { z } from "zod";
import { idSchema } from "./admin";

export const MAX_COMMENT_LENGTH = 1000;

const slug = z
  .string()
  .max(200)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const commentFormSchema = z.object({
  slug,
  body: z
    .string()
    // Tidy whitespace: no trailing spaces, at most one blank line in a row.
    .transform((v) =>
      v
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t]+$/gm, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
    )
    .pipe(z.string().min(1).max(MAX_COMMENT_LENGTH)),
});

export const commentDeleteSchema = z.object({ commentId: idSchema });

export const commentModerationSchema = z.object({
  commentId: idSchema,
  action: z.enum(["hide", "show"]),
});

export const commentListSchema = z.object({ slug });
