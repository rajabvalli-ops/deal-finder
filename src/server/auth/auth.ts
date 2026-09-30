import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import type { PrismaClient } from "@/generated/prisma/client";
import { site } from "@/lib/site";
import { db } from "@/server/db/client";
import { env } from "@/server/env";

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

type AuthOptions = {
  client: PrismaClient;
  secret: string;
  baseURL: string;
  production: boolean;
  /** Defaults to on in production only (Better Auth's default). */
  rateLimit?: boolean;
};

/** Builds the Better Auth instance. Exposed as a factory so tests can supply their own options. */
export function createAuth(options: AuthOptions) {
  return betterAuth({
    appName: site.name,
    baseURL: options.baseURL,
    secret: options.secret,
    database: prismaAdapter(options.client, { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      autoSignIn: true,
    },
    user: {
      additionalFields: {
        // input: false — sign-up requests can never choose their own role.
        role: { type: "string", required: false, defaultValue: "USER", input: false },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: options.rateLimit ?? options.production,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60 * 60, max: 5 },
      },
    },
    advanced: {
      useSecureCookies: options.production,
      // Better Auth skips its origin/CSRF check when NODE_ENV=test or TEST is set. Keep it on
      // everywhere so protection never depends on an environment variable.
      disableOriginCheck: false,
    },
    // Must be last: lets Server Actions set auth cookies.
    plugins: [nextCookies()],
  });
}

export const auth = createAuth({
  client: db,
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.NEXT_PUBLIC_SITE_URL,
  production: env.NODE_ENV === "production",
});

export type Auth = typeof auth;
