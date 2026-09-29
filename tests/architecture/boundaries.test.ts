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
  ])("%s allows %s", async (filePath, source) => {
    expect(await restrictedImports(filePath, source)).toBe(0);
  });
});
