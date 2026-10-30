import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// Verifies the module-boundary rules in eslint.config.mjs actually fire.
const eslint = new ESLint();

async function restrictedImports(filePath: string, source: string): Promise<number> {
  const [result] = await eslint.lintText(`${source}\nexport {};\n`, { filePath });
  return result?.messages.filter((m) => m.ruleId === "no-restricted-imports").length ?? 0;
}

describe("module boundaries", () => {
  it.each([
    ["src/app/(public)/page.tsx", 'import "@/server/db/client";'],
    ["src/app/(public)/page.tsx", 'import "@prisma/client";'],
    ["src/app/(public)/page.tsx", 'import "@/generated/prisma/client";'],
    ["src/components/public/deal-card.tsx", 'import "@/generated/prisma/enums";'],
    ["src/server/services/deal.service.ts", 'import "@/generated/prisma/client";'],
    ["src/server/services/deal.service.ts", 'import "../../generated/prisma/client";'],
    ["src/app/api/cron/import/route.ts", 'import "@/server/retailers/registry";'],
    ["src/components/public/deal-card.tsx", 'import "@/server/services/deal.service";'],
    ["src/lib/money.ts", 'import "@/server/env";'],
    ["src/lib/money.ts", 'import "server-only";'],
    ["src/server/pricing/price-stats.ts", 'import "@/server/db/client";'],
    ["src/server/pricing/price-stats.ts", 'import "next/cache";'],
    ["src/server/deals/engine/rules.ts", 'import "react";'],
    ["src/server/deals/engine/rules.ts", 'import "@/server/retailers/types";'],
    ["src/server/retailers/adapters/mock/index.ts", 'import "@/server/db/client";'],
    ["src/server/affiliate/click-meta.ts", 'import "@/server/db/client";'],
    ["src/server/affiliate/click-meta.ts", 'import "next/server";'],
    ["src/server/affiliate/codes.ts", 'import "@/server/retailers";'],
  ])("%s rejects %s", async (filePath, source) => {
    expect(await restrictedImports(filePath, source)).toBe(1);
  });

  it.each([
    ["src/app/(public)/page.tsx", 'import "@/server/env";'],
    ["src/app/(public)/page.tsx", 'import "@/components/ui/page-placeholder";'],
    ["src/server/deals/engine/rules.ts", 'import "@/server/pricing/price-stats";'],
    ["src/server/services/ingestion.service.ts", 'import "@/server/retailers/registry";'],
    ["src/server/services/deal.service.ts", 'import "@/server/db/client";'],
    ["src/server/db/client.ts", 'import "@/generated/prisma/client";'],
    ["src/server/db/client.ts", 'import "@prisma/adapter-pg";'],
    ["src/app/go/[code]/route.ts", 'import "@/server/services/affiliate";'],
    ["src/server/affiliate/click-meta.ts", 'import "node:crypto";'],
  ])("%s allows %s", async (filePath, source) => {
    expect(await restrictedImports(filePath, source)).toBe(0);
  });

  it.each([
    ["src/server/pricing/price-stats.ts", "const t = Date.now();"],
    ["src/server/pricing/price-stats.ts", "const t = new Date();"],
    ["src/server/deals/engine/score.ts", "const r = Math.random();"],
    ["src/server/deals/engine/score.ts", "const t = performance.now();"],
  ])("%s may not read the clock or randomness: %s", async (filePath, source) => {
    const [result] = await eslint.lintText(`${source}\nexport { };\n`, { filePath });
    const ids = result?.messages.map((m) => m.ruleId) ?? [];
    expect(
      ids.some((id) => id === "no-restricted-properties" || id === "no-restricted-syntax"),
    ).toBe(true);
  });

  it("engines may still construct dates from inputs", async () => {
    const [result] = await eslint.lintText("export const d = (ms: number) => new Date(ms);\n", {
      filePath: "src/server/pricing/price-stats.ts",
    });
    expect(result?.messages ?? []).toEqual([]);
  });
});
