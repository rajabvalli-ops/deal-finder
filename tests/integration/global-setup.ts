import { execFileSync } from "node:child_process";
import { assertTestDatabase } from "./test-database";

/** Applies migrations to the test database once before the integration suite. */
export default function setup() {
  const url = assertTestDatabase();
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: url },
  });
}
