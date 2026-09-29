import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Module boundaries from docs/ARCHITECTURE.md §1. Each entry restricts what a
// layer may import, so the separation of concerns is enforced, not just documented.
const PRISMA = {
  group: ["@prisma/client", "@prisma/client/*"],
  message: "Use a service; only src/server/db talks to Prisma.",
};
const DB = {
  group: ["@/server/db", "@/server/db/*"],
  message: "Use a service; only services use the data-access layer.",
};
const ADAPTERS = {
  group: ["@/server/retailers", "@/server/retailers/*"],
  message: "Retailer adapters are only used by the ingestion service and jobs.",
};
const ANY_SERVER = {
  group: ["@/server", "@/server/*"],
  message: "Components receive data as props; fetch data in pages via services.",
};
const FRAMEWORK = {
  group: ["next", "next/*", "react", "react-dom", "react/*"],
  message: "Engines are pure TypeScript with no framework dependencies.",
};

function restrict(files, patterns) {
  return { files, rules: { "no-restricted-imports": ["error", { patterns }] } };
}

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
  ]),
  restrict(["src/app/**"], [PRISMA, DB, ADAPTERS]),
  restrict(["src/components/**"], [PRISMA, ANY_SERVER]),
  restrict(
    ["src/lib/**"],
    [PRISMA, ANY_SERVER, { group: ["server-only"], message: "src/lib must stay isomorphic." }],
  ),
  restrict(
    ["src/server/pricing/**", "src/server/deals/engine/**"],
    [PRISMA, DB, ADAPTERS, FRAMEWORK],
  ),
  restrict(["src/server/retailers/**"], [PRISMA, DB]),
]);
