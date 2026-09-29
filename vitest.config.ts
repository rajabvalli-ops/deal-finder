import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws outside a React Server Components build; tests run server code directly.
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // env.ts validates at import time; unit tests never connect, so a placeholder is enough.
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://unit-tests@localhost:5432/unused",
    },
    include: ["src/**/*.test.ts", "tests/architecture/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: [
        "src/lib/money.ts",
        "src/lib/slug.ts",
        "src/lib/safe-redirect.ts",
        "src/lib/chart.ts",
        "src/lib/format.ts",
        "src/lib/pagination.ts",
        "src/lib/public-types.ts",
        "src/lib/security-headers.ts",
        "src/lib/validation/**",
        "src/server/auth/roles.ts",
        "src/server/rate-limit/**",
        "src/server/jobs/cron-auth.ts",
        "src/server/pricing/**",
        "src/server/deals/engine/**",
        "src/server/deals/workflow.ts",
        "src/server/retailers/**",
        "src/server/services/ingestion/observation-policy.ts",
        "src/server/services/ingestion/price-snapshot.ts",
      ],
      exclude: [
        "**/*.test.ts",
        "**/*.test-kit.ts",
        "**/types.ts",
        // Re-export barrels only; adapters/mock/index.ts is real code and stays covered.
        "src/server/pricing/index.ts",
        "src/server/deals/engine/index.ts",
        "src/server/retailers/index.ts",
      ],
      // Pure logic must stay fully tested.
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  },
});
