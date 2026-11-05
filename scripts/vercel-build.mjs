// Vercel build: on production deploys, apply database migrations and the (idempotent)
// reference-data seed before building, so going live needs no terminal. Preview deploys only
// build, so a branch can never change the production database.
//
// Vercel runs this automatically because package.json has a "vercel-build" script.
import { execSync } from "node:child_process";

const run = (command, env = {}) =>
  execSync(command, { stdio: "inherit", env: { ...process.env, ...env } });

if (process.env.VERCEL_ENV === "production") {
  run("npx prisma migrate deploy");
  // NODE_ENV=production keeps development-only data (the mock retailer) out.
  run("npx prisma db seed", { NODE_ENV: "production" });
} else {
  console.log(`Skipping migrations and seed (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}).`);
}
run("npx next build");
