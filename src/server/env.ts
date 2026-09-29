import "server-only";
import { z } from "zod";

const DEFAULT_SITE_URL = "http://localhost:3000";
/** Only ever used outside production, where BETTER_AUTH_SECRET is mandatory. */
const DEVELOPMENT_AUTH_SECRET = "development-only-auth-secret-not-for-production";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    NEXT_PUBLIC_SITE_URL: z.url({ protocol: /^https?$/ }).optional(),
    DATABASE_URL: z.url({
      protocol: /^postgres(ql)?$/,
      error: "DATABASE_URL must be a postgres:// or postgresql:// connection string",
    }),
    /** Signs session cookies. Required in production; a fixed development value is used otherwise. */
    BETTER_AUTH_SECRET: z
      .string()
      .min(32, "BETTER_AUTH_SECRET must be at least 32 characters")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    /** Bearer token Vercel Cron sends to /api/cron/*. Unset = cron endpoints refuse all calls. */
    CRON_SECRET: z
      .string()
      .min(32, "CRON_SECRET must be at least 32 characters")
      .optional()
      .or(z.literal("").transform(() => undefined)),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === "production" && !value.BETTER_AUTH_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["BETTER_AUTH_SECRET"],
        message: "BETTER_AUTH_SECRET is required in production",
      });
    }
    if (value.NODE_ENV === "production" && !value.NEXT_PUBLIC_SITE_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_SITE_URL"],
        message: "NEXT_PUBLIC_SITE_URL is required in production",
      });
    }
  })
  .transform((value) => ({
    NODE_ENV: value.NODE_ENV,
    DATABASE_URL: value.DATABASE_URL,
    CRON_SECRET: value.CRON_SECRET,
    BETTER_AUTH_SECRET: value.BETTER_AUTH_SECRET ?? DEVELOPMENT_AUTH_SECRET,
    NEXT_PUBLIC_SITE_URL: (value.NEXT_PUBLIC_SITE_URL ?? DEFAULT_SITE_URL).replace(/\/+$/, ""),
  }));

export type Env = z.infer<typeof envSchema>;

/** Validates raw environment variables, throwing a readable error listing every problem. */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export const env = parseEnv(process.env);
