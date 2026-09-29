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
  },
});
