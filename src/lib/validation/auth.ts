import { z } from "zod";

// Mirrors PASSWORD_MIN_LENGTH / PASSWORD_MAX_LENGTH in src/server/auth/auth.ts.
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const signInSchema = z.object({
  email,
  password: z.string().min(1).max(PASSWORD_MAX),
});

export const signUpSchema = z.object({
  name: z.string().trim().max(100).default(""),
  email,
  password: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX),
});
