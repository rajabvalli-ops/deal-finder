import "dotenv/config";
import { defineConfig } from "vitest/config";
import unitConfig from "./vitest.config";

export default defineConfig({
  resolve: unitConfig.resolve,
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // Point the app's own `db` client at the test database too.
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? "" },
    globalSetup: ["tests/integration/global-setup.ts"],
    setupFiles: ["tests/integration/setup.ts"],
    // Tests share one database, so run files one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
